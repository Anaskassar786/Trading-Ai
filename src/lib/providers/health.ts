// Provider health testing: probes the actual fallback chains, never exposes keys.
import "server-only";
import { getEnv } from "../env";
import type { ApiHealthStatus } from "../types";
import { VISION_CHAIN, TEXT_CHAIN, JUDGE_CHAIN, type FallbackEntry } from "../fallback-chain";
import { validateTwelveData } from "./market";
import { validateFred } from "./macro";
import { validateNewsApi } from "./news";

type LlmProvider = "nvidia" | "openrouter" | "gemini";

const PROBE_TIMEOUT = 20_000;
const PROBE_DELAY = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The first six unique entries for a provider across all role chains. */
function chainModels(provider: LlmProvider): string[] {
  const seen = new Set<string>();
  const entries: FallbackEntry[] = [...VISION_CHAIN, ...TEXT_CHAIN, ...JUDGE_CHAIN];
  const models: string[] = [];
  for (const entry of entries) {
    if (entry.provider !== provider || seen.has(entry.model_id)) continue;
    seen.add(entry.model_id);
    models.push(entry.model_id);
    if (models.length >= 6) break;
  }
  return models;
}

async function probeOpenAIModel(
  base: string,
  key: string,
  modelId: string
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: ctl.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      text: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkOpenAICompat(
  provider: LlmProvider,
  base: string,
  key: string | undefined
): Promise<ApiHealthStatus> {
  const rec: ApiHealthStatus = {
    provider,
    configured: Boolean(key),
    reachable: false,
    auth_valid: false,
    endpoint_valid: false,
    model_valid: false,
  };
  if (!key) {
    rec.last_error = "No API key configured.";
    return rec;
  }

  const started = Date.now();
  const modelsUrl = `${base.replace(/\/$/, "")}/models`;
  let listingSucceeded = false;
  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 15_000);
    const response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctl.signal,
    });
    clearTimeout(timeout);
    const text = await response.text();
    rec.reachable = true;
    rec.endpoint_valid = response.ok || response.status === 401 || response.status === 403;
    if (response.ok) {
      listingSucceeded = true;
      rec.auth_valid = true;
      // Parse only to verify that the provider returned a normal listing. The
      // chain, rather than this optional catalog, determines which models ping.
      try {
        const json = JSON.parse(text);
        if (!Array.isArray(json?.data) && !Array.isArray(json?.models)) {
          rec.note = "Provider authenticated, but /models returned an unexpected listing shape.";
        }
      } catch {
        rec.note = "Provider authenticated, but /models response was not JSON.";
      }
    } else if (response.status === 401 || response.status === 403) {
      rec.last_error = `Auth error (HTTP ${response.status}).`;
    } else {
      rec.last_error = `HTTP ${response.status}: ${text.slice(0, 200)}`;
    }
  } catch (error: any) {
    rec.last_error = `Network error: ${error?.name === "AbortError" ? "timeout" : String(error?.message ?? error)}`;
    rec.latency_ms = Date.now() - started;
    return rec;
  }

  if (!listingSucceeded) {
    rec.latency_ms = Date.now() - started;
    return rec;
  }

  const tried = chainModels(provider);
  const working: string[] = [];
  let lastProbeError = "";
  let rateLimited = false;
  for (let i = 0; i < tried.length; i++) {
    if (i > 0) await sleep(PROBE_DELAY);
    const probe = await probeOpenAIModel(base, key, tried[i]);
    if (probe.ok) {
      working.push(tried[i]);
    } else {
      lastProbeError = `HTTP ${probe.status || "network"} for ${tried[i]}`;
      if (probe.status === 429) rateLimited = true;
    }
  }

  rec.latency_ms = Date.now() - started;
  if (working.length > 0) {
    rec.model_valid = true;
    rec.note = `Working models: ${working.join(", ")}`;
    rec.last_success_at = new Date().toISOString();
  } else {
    rec.model_valid = false;
    rec.note = tried.length
      ? `No working fallback models. Tried: ${tried.join(", ")}`
      : "No fallback models configured for this provider.";
    if (lastProbeError) rec.last_error = `${lastProbeError}${rateLimited ? " (rate-limited during probe)" : ""}`;
  }
  return rec;
}

async function probeGeminiModel(
  key: string,
  modelId: string
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 5 },
      }),
      signal: ctl.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      text: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkGemini(): Promise<ApiHealthStatus> {
  const key = getEnv("GEMINI_API_KEY");
  const rec: ApiHealthStatus = {
    provider: "gemini",
    configured: Boolean(key),
    reachable: false,
    auth_valid: false,
    endpoint_valid: false,
    model_valid: false,
  };
  if (!key) {
    rec.last_error = "No API key configured.";
    return rec;
  }

  const started = Date.now();
  let listingSucceeded = false;
  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 15_000);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { signal: ctl.signal }
    );
    clearTimeout(timeout);
    const text = await response.text();
    rec.reachable = true;
    rec.endpoint_valid = true;
    if (response.ok) {
      listingSucceeded = true;
      rec.auth_valid = true;
      try {
        JSON.parse(text);
      } catch {
        rec.note = "Provider authenticated, but /models response was not JSON.";
      }
    } else if (response.status === 401 || response.status === 403) {
      rec.auth_valid = false;
      rec.last_error = `Auth error (HTTP ${response.status}): ${text.slice(0, 200)}`;
    } else {
      rec.last_error = `HTTP ${response.status}: ${text.slice(0, 200)}`;
    }
  } catch (error: any) {
    rec.last_error = `Network error: ${error?.name === "AbortError" ? "timeout" : String(error?.message ?? error)}`;
    rec.latency_ms = Date.now() - started;
    return rec;
  }

  if (!listingSucceeded) {
    rec.latency_ms = Date.now() - started;
    return rec;
  }

  const tried = chainModels("gemini");
  const working: string[] = [];
  let rateLimited = false;
  let lastProbeError = "";
  for (let i = 0; i < tried.length; i++) {
    if (i > 0) await sleep(PROBE_DELAY);
    const probe = await probeGeminiModel(key, tried[i]);
    if (probe.ok) {
      working.push(tried[i]);
    } else {
      lastProbeError = `HTTP ${probe.status || "network"} for ${tried[i]}`;
      if (probe.status === 429) rateLimited = true;
    }
  }

  rec.latency_ms = Date.now() - started;
  if (working.length > 0) {
    rec.model_valid = true;
    rec.note = `Working models: ${working.join(", ")}`;
    rec.last_success_at = new Date().toISOString();
  } else if (rateLimited) {
    // A valid /models listing is authoritative when quota blocks the tiny ping.
    rec.model_valid = true;
    rec.note = "rate-limited during probe; model believed valid";
    rec.last_success_at = new Date().toISOString();
  } else {
    rec.model_valid = false;
    rec.note = tried.length
      ? `No working fallback models. Tried: ${tried.join(", ")}`
      : "No fallback models configured for Gemini.";
    if (lastProbeError) rec.last_error = lastProbeError;
  }
  return rec;
}

async function checkMiniMax(): Promise<ApiHealthStatus> {
  const key = getEnv("MINIMAX_API_KEY");
  const rec: ApiHealthStatus = {
    provider: "minimax",
    configured: Boolean(key),
    reachable: false,
    auth_valid: false,
    endpoint_valid: false,
    model_valid: false,
    note:
      "Direct MiniMax endpoint is NOT configured in this build. MiniMax M3 is accessed through NVIDIA (minimaxai/minimax-m3) by default.",
  };
  if (!key) rec.last_error = "No MiniMax key configured.";
  return rec;
}

export async function runHealthChecks(): Promise<ApiHealthStatus[]> {
  const [nvidia, openrouter, gemini, minimax, twelvedata, fred, newsapi] = await Promise.all([
    checkOpenAICompat("nvidia", "https://integrate.api.nvidia.com/v1", getEnv("NVIDIA_API_KEY")),
    checkOpenAICompat("openrouter", "https://openrouter.ai/api/v1", getEnv("OPENROUTER_API_KEY")),
    checkGemini(),
    checkMiniMax(),
    validateTwelveData().then((value) => ({
      provider: "twelvedata",
      configured: Boolean(getEnv("TWELVE_DATA_API_KEY")),
      reachable: value.ok,
      auth_valid: value.ok,
      endpoint_valid: value.ok,
      model_valid: value.ok,
      latency_ms: value.latency_ms,
      last_error: value.error,
      last_success_at: value.ok ? new Date().toISOString() : undefined,
    })),
    validateFred().then((value) => ({
      provider: "fred",
      configured: Boolean(getEnv("FRED_API_KEY")),
      reachable: value.ok,
      auth_valid: value.ok,
      endpoint_valid: value.ok,
      model_valid: value.ok,
      latency_ms: value.latency_ms,
      last_error: value.error,
      last_success_at: value.ok ? new Date().toISOString() : undefined,
    })),
    validateNewsApi().then((value) => ({
      provider: "newsapi",
      configured: Boolean(getEnv("NEWS_API_KEY")),
      reachable: value.ok,
      auth_valid: value.ok,
      endpoint_valid: value.ok,
      model_valid: value.ok,
      latency_ms: value.latency_ms,
      last_error: value.error,
      last_success_at: value.ok ? new Date().toISOString() : undefined,
    })),
  ]);
  return [nvidia, openrouter, gemini, minimax, twelvedata, fred, newsapi];
}
