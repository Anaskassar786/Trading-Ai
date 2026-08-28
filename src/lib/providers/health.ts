// Provider health testing: NVIDIA, OpenRouter, Gemini, MiniMax, Twelve Data, FRED, News API.
// Never exposes keys. Reports only Configured/Reachable/Auth/Model-valid.
import "server-only";
import { getEnv } from "../env";
import type { ApiHealthStatus, ModelConfig } from "../types";
import { buildEffectiveModels } from "../model-registry";
import { validateTwelveData } from "./market";
import { validateFred } from "./macro";
import { validateNewsApi } from "./news";

async function checkOpenAICompat(
  provider: "nvidia" | "openrouter",
  base: string,
  key: string | undefined,
  modelId: string | undefined
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
  if (!modelId) {
    rec.last_error = "No model ID configured.";
    return rec;
  }
  // 1) lightweight /models check to validate base URL + auth
  const modelsUrl = `${base.replace(/\/$/, "")}/models`;
  const start = Date.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctl.signal,
    });
    clearTimeout(to);
    rec.latency_ms = Date.now() - start;
    const txt = await r.text();
    rec.endpoint_valid = r.ok || r.status === 401 || r.status === 403; // URL exists
    if (r.ok) {
      rec.reachable = true;
      rec.auth_valid = true;
      try {
        const j = JSON.parse(txt);
        const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
        const found = list.some((m: any) => m.id === modelId || m.id?.includes(modelId));
        rec.model_valid = found;
        if (!found) {
          rec.note = `Model "${modelId}" not found in /models listing; may still be accepted by chat completions but not advertised.`;
        }
      } catch {
        rec.note = "Could not parse /models response.";
      }
      rec.last_success_at = new Date().toISOString();
    } else if (r.status === 401 || r.status === 403) {
      rec.reachable = true;
      rec.auth_valid = false;
      rec.last_error = `Auth error (HTTP ${r.status}).`;
    } else {
      rec.reachable = true;
      rec.last_error = `HTTP ${r.status}: ${txt.slice(0, 200)}`;
    }
  } catch (e: any) {
    rec.latency_ms = Date.now() - start;
    const err = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
    rec.last_error = `Network error: ${err}`;
    return rec;
  }
  // 2) Try a trivial chat-completions call to further validate model
  if (rec.auth_valid) {
    const chatUrl = `${base.replace(/\/$/, "")}/chat/completions`;
    const cstart = Date.now();
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 20000);
      const cr = await fetch(chatUrl, {
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
      clearTimeout(to);
      rec.latency_ms = Date.now() - cstart;
      const ctxt = await cr.text();
      if (cr.ok) {
        rec.model_valid = true;
        rec.last_success_at = new Date().toISOString();
      } else {
        rec.last_error = `Chat HTTP ${cr.status}: ${ctxt.slice(0, 300)}`;
      }
    } catch (e: any) {
      rec.last_error = `Chat network error: ${String(e?.message ?? e)}`;
    }
  }
  return rec;
}

async function checkGemini(modelId: string | undefined): Promise<ApiHealthStatus> {
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
  if (!modelId) {
    rec.last_error = "No Gemini model ID configured.";
    return rec;
  }
  const start = Date.now();
  try {
    // Use models.list to verify key
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    rec.latency_ms = Date.now() - start;
    const txt = await r.text();
    rec.endpoint_valid = true;
    rec.reachable = true;
    if (r.ok) {
      rec.auth_valid = true;
      const j = JSON.parse(txt);
      const list: any[] = Array.isArray(j?.models) ? j.models : [];
      const found = list.some((m) => m.name?.endsWith(modelId) || m.name?.includes(modelId));
      rec.model_valid = found;
      if (!found) rec.note = `Model "${modelId}" not found in /models listing.`;
      rec.last_success_at = new Date().toISOString();
    } else {
      rec.last_error = `HTTP ${r.status}: ${txt.slice(0, 200)}`;
    }
  } catch (e: any) {
    rec.latency_ms = Date.now() - start;
    rec.last_error = `Network: ${String(e?.message ?? e)}`;
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
  if (!key) {
    rec.last_error = "No MiniMax key configured.";
    return rec;
  }
  // The provided key begins with "nvapi-" or "Bearernvapi-" and is actually an NVIDIA key;
  // do not invent a direct MiniMax endpoint.
  return rec;
}

export async function runHealthChecks(): Promise<ApiHealthStatus[]> {
  const models = buildEffectiveModels();
  // For each provider pick the model currently routed to it; if none, fall back
  // to a reasonable default test model id so the /models list & auth can still be
  // validated without fabricating predictions.
  function pickModel(provider: string, fallback?: string): string | undefined {
    for (const m of [models.vision, models.text, models.judge]) {
      if (m && m.provider === provider) return m.model_id;
    }
    return fallback;
  }
  const nvidiaModel = pickModel("nvidia", "minimaxai/minimax-m3");
  const orModel = pickModel("openrouter", "openai/gpt-4o-mini");
  const geminiModel = pickModel("gemini", "gemini-1.5-flash");

  const [nvidia, openrouter, gemini, minimax, twelvedata, fred, newsapi] = await Promise.all([
    checkOpenAICompat("nvidia", "https://integrate.api.nvidia.com/v1", getEnv("NVIDIA_API_KEY"), nvidiaModel),
    checkOpenAICompat("openrouter", "https://openrouter.ai/api/v1", getEnv("OPENROUTER_API_KEY"), orModel),
    checkGemini(geminiModel),
    checkMiniMax(),
    validateTwelveData().then((v) => ({
      provider: "twelvedata",
      configured: Boolean(getEnv("TWELVE_DATA_API_KEY")),
      reachable: v.ok,
      auth_valid: v.ok,
      endpoint_valid: v.ok,
      model_valid: v.ok,
      latency_ms: v.latency_ms,
      last_error: v.error,
      last_success_at: v.ok ? new Date().toISOString() : undefined,
    })),
    validateFred().then((v) => ({
      provider: "fred",
      configured: Boolean(getEnv("FRED_API_KEY")),
      reachable: v.ok,
      auth_valid: v.ok,
      endpoint_valid: v.ok,
      model_valid: v.ok,
      latency_ms: v.latency_ms,
      last_error: v.error,
      last_success_at: v.ok ? new Date().toISOString() : undefined,
    })),
    validateNewsApi().then((v) => ({
      provider: "newsapi",
      configured: Boolean(getEnv("NEWS_API_KEY")),
      reachable: v.ok,
      auth_valid: v.ok,
      endpoint_valid: v.ok,
      model_valid: v.ok,
      latency_ms: v.latency_ms,
      last_error: v.error,
      last_success_at: v.ok ? new Date().toISOString() : undefined,
    })),
  ]);

  const results = [nvidia, openrouter, gemini, minimax, twelvedata, fred, newsapi];
  return results;
}
