// Unified server-only LLM client for NVIDIA, OpenRouter, Gemini, and MiniMax.
// It owns provider pacing, retries, failover, circuit breaking, and auditing.
import "server-only";
import { getEnv } from "./env";
import { appendAudit } from "./db";
import { getModelChain } from "./model-registry";
import type { ModelConfig } from "./types";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  /** Number of retries after the initial attempt on the same model. */
  retries?: number;
  sessionId?: string;
  agentLabel?: string;
}

export interface LLMResult {
  text: string;
  latency_ms: number;
  provider: string;
  model: string;
  error?: string;
  /** Internal response metadata used for Retry-After-aware backoff. */
  retry_after_ms?: number;
}

export type LLMRole = "vision" | "text" | "judge";

const DEFAULT_TIMEOUT = 90_000;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_RETRIES = 3;
const MODEL_SWITCH_DELAY = 2000;
const RETRY_BACKOFF_MS = [3000, 7000, 15000];
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_MS = 60_000;

const MIN_SPACING: Record<ModelConfig["provider"], number> = {
  gemini: 1500,
  openrouter: 300,
  nvidia: 300,
  minimax: 300,
};

// These maps intentionally live in the server process only. They reset on a
// deploy/restart, which is preferable to persisting quota/circuit state.
const lastCallAt = new Map<ModelConfig["provider"], number>();
const circuitCalls = new Map<
  ModelConfig["provider"],
  { at: number; rateLimited: boolean }[]
>();
const circuitOpenUntil = new Map<ModelConfig["provider"], number>();

function toDataUrl(mime: string, b64: string) {
  return `data:${mime};base64,${b64}`;
}

export function imagePartFromBase64(b64: string, mime: string): ContentPart {
  return { type: "image_url", image_url: { url: toDataUrl(mime, b64) } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Reserve the next start time for this provider, including concurrent callers. */
async function waitForProvider(provider: ModelConfig["provider"]): Promise<void> {
  const now = Date.now();
  const previous = lastCallAt.get(provider) ?? 0;
  const scheduled = Math.max(now, previous + MIN_SPACING[provider]);
  lastCallAt.set(provider, scheduled);
  await sleep(scheduled - now);
}

function retryAfterMs(resp: Response): number | undefined {
  const raw = resp.headers.get("retry-after");
  if (!raw || !/^\s*\d+\s*$/.test(raw)) return undefined;
  const seconds = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(30, Math.max(0, seconds)) * 1000;
}

function errorResult(
  provider: string,
  model: string,
  error: string,
  latency_ms = 0,
  retry_after_ms?: number
): LLMResult {
  return { text: "", latency_ms, provider, model, error, retry_after_ms };
}

/** Call an OpenAI-compatible endpoint (NVIDIA or OpenRouter). */
async function callOpenAICompat(
  cfg: ModelConfig,
  messages: LLMMessage[],
  opts: LLMCallOptions
): Promise<LLMResult> {
  const key = getEnv(cfg.api_key_env as any);
  if (!key) {
    return errorResult(
      cfg.provider,
      cfg.model_id,
      `Missing API key for ${cfg.provider} (env ${cfg.api_key_env})`
    );
  }
  if (!cfg.base_url) {
    return errorResult(
      cfg.provider,
      cfg.model_id,
      `No base URL configured for provider ${cfg.provider}.`
    );
  }
  const url = `${cfg.base_url.replace(/\/$/, "")}/chat/completions`;
  const body: any = {
    model: cfg.model_id,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://trading-ai-ak.local";
    headers["X-Title"] = "Trading AI AK";
  }

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const start = Date.now();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    const err = e?.name === "AbortError" ? "request timeout" : String(e?.message ?? e);
    return errorResult(
      cfg.provider,
      cfg.model_id,
      `Network error: ${err}`,
      Date.now() - start
    );
  }
  clearTimeout(timeout);
  const latency = Date.now() - start;
  const text = await resp.text();
  if (!resp.ok) {
    return errorResult(
      cfg.provider,
      cfg.model_id,
      `HTTP ${resp.status}: ${text.slice(0, 500)}`,
      latency,
      retryAfterMs(resp)
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return errorResult(
      cfg.provider,
      cfg.model_id,
      `Invalid JSON: ${text.slice(0, 300)}`,
      latency
    );
  }
  const content = data?.choices?.[0]?.message?.content ?? "";
  return {
    text: typeof content === "string" ? content : JSON.stringify(content),
    latency_ms: latency,
    provider: cfg.provider,
    model: cfg.model_id,
  };
}

/** Call Gemini native REST. */
async function callGemini(
  cfg: ModelConfig,
  messages: LLMMessage[],
  opts: LLMCallOptions
): Promise<LLMResult> {
  const key = getEnv(cfg.api_key_env as any);
  if (!key) {
    return errorResult(
      "gemini",
      cfg.model_id,
      `Missing API key for Gemini (env ${cfg.api_key_env})`
    );
  }

  const contents: any[] = [];
  let systemInstruction: any = undefined;
  for (const message of messages) {
    if (message.role === "system") {
      systemInstruction = {
        parts: [{ text: typeof message.content === "string" ? message.content : "" }],
      };
      continue;
    }
    const parts: any[] = [];
    if (typeof message.content === "string") {
      parts.push({ text: message.content });
    } else {
      for (const part of message.content) {
        if (part.type === "text") parts.push({ text: part.text });
        else if (part.type === "image_url") {
          const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
          if (match) {
            parts.push({
              inline_data: { mime_type: match[1], data: match[2] },
            });
          }
        }
      }
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  const generationConfig: any = {
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (opts.jsonMode) generationConfig.responseMimeType = "application/json";

  const url = `${cfg.base_url}/models/${encodeURIComponent(
    cfg.model_id
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const body: any = { contents, generationConfig };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const start = Date.now();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    const err = e?.name === "AbortError" ? "request timeout" : String(e?.message ?? e);
    return errorResult(
      "gemini",
      cfg.model_id,
      `Network error: ${err}`,
      Date.now() - start
    );
  }
  clearTimeout(timeout);
  const latency = Date.now() - start;
  const text = await resp.text();
  if (!resp.ok) {
    return errorResult(
      "gemini",
      cfg.model_id,
      `HTTP ${resp.status}: ${text.slice(0, 500)}`,
      latency,
      retryAfterMs(resp)
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return errorResult(
      "gemini",
      cfg.model_id,
      `Invalid JSON: ${text.slice(0, 300)}`,
      latency
    );
  }
  const output =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text ?? "")
      .join("") ?? "";
  return {
    text: output,
    latency_ms: latency,
    provider: "gemini",
    model: cfg.model_id,
  };
}

/** MiniMax remains intentionally unconfigured unless a direct endpoint is added. */
async function callMiniMax(
  cfg: ModelConfig,
  messages: LLMMessage[],
  opts: LLMCallOptions
): Promise<LLMResult> {
  if (!cfg.base_url) {
    return errorResult(
      "minimax",
      cfg.model_id,
      "Direct MiniMax endpoint NOT configured. The provided MiniMax key looks like an NVIDIA-issued token; route MiniMax through NVIDIA."
    );
  }
  return callOpenAICompat(cfg, messages, opts);
}

function isTransientError(error: string | undefined): boolean {
  if (!error) return false;
  return /HTTP (429|5\d\d)\b|Network error|request timeout/i.test(error);
}

function isNoRetryError(error: string | undefined): boolean {
  if (!error) return false;
  return /HTTP (401|403|404)\b|Missing API key|No base URL configured|Invalid JSON/i.test(error);
}

function recordCircuitOutcome(
  provider: ModelConfig["provider"],
  rateLimited: boolean
): void {
  const now = Date.now();
  const recent = (circuitCalls.get(provider) ?? []).filter(
    (call) => now - call.at < CIRCUIT_WINDOW_MS
  );
  recent.push({ at: now, rateLimited });
  circuitCalls.set(provider, recent);
  const lastThree = recent.slice(-3);
  if (lastThree.length === 3 && lastThree.every((call) => call.rateLimited)) {
    circuitOpenUntil.set(provider, now + CIRCUIT_OPEN_MS);
  }
}

function providerCircuitOpen(provider: ModelConfig["provider"]): boolean {
  const now = Date.now();
  const openUntil = circuitOpenUntil.get(provider) ?? 0;
  if (openUntil > now) return true;
  if (openUntil) circuitOpenUntil.delete(provider);
  const recent = (circuitCalls.get(provider) ?? []).filter(
    (call) => now - call.at < CIRCUIT_WINDOW_MS
  );
  circuitCalls.set(provider, recent);
  const lastThree = recent.slice(-3);
  return lastThree.length === 3 && lastThree.every((call) => call.rateLimited);
}

function orderCandidates(candidates: ModelConfig[]): ModelConfig[] {
  // Stable sort: an open provider is moved behind all healthy providers while
  // still remaining available as a last resort.
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const aOpen = providerCircuitOpen(a.candidate.provider) ? 1 : 0;
      const bOpen = providerCircuitOpen(b.candidate.provider) ? 1 : 0;
      return aOpen - bOpen || a.index - b.index;
    })
    .map(({ candidate }) => candidate);
}

function jitteredBackoff(retryNumber: number): number {
  const base = RETRY_BACKOFF_MS[Math.min(retryNumber, RETRY_BACKOFF_MS.length - 1)];
  // Keep the requested 3s / 7s / 15s schedule while avoiding synchronized retries.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function auditAttempt(res: LLMResult, opts: LLMCallOptions): void {
  appendAudit({
    session_id: opts.sessionId,
    provider: res.provider,
    model: res.model,
    agent: opts.agentLabel,
    request_status: res.error ? "ERROR" : "OK",
    latency_ms: res.latency_ms,
    error: res.error,
  });
}

/**
 * Call either one explicit ModelConfig (backward compatible) or an ordered role
 * chain. Every actual attempt is audited; successful calls get one additional
 * winner audit entry.
 */
export async function callLLM(
  modelOrRole: ModelConfig | null | LLMRole,
  messages: LLMMessage[],
  opts: LLMCallOptions = {}
): Promise<LLMResult> {
  const roleCall = typeof modelOrRole === "string";
  const configuredCandidates = typeof modelOrRole === "string"
    ? getModelChain(modelOrRole)
    : modelOrRole
      ? [modelOrRole]
      : [];
  // Never send chart bytes to a text-only user override. The hardcoded vision
  // entries are all annotated/capability-detected as multimodal.
  const candidates = roleCall && modelOrRole === "vision"
    ? configuredCandidates.filter((candidate) => candidate.supports_image)
    : configuredCandidates;

  if (candidates.length === 0) {
    return {
      text: "",
      latency_ms: 0,
      provider: roleCall ? "chain-failed" : "none",
      model: "none",
      error: roleCall
        ? `No enabled models in the ${modelOrRole} fallback chain.`
        : "No model configured",
    };
  }

  const pending = candidates.slice();
  const retries = Math.max(0, opts.retries ?? DEFAULT_RETRIES);
  let lastError: LLMResult | null = null;
  let totalLatency = 0;

  while (pending.length > 0) {
    const next = orderCandidates(pending);
    const cfg = next[0];
    const index = pending.indexOf(cfg);
    pending.splice(index, 1);

    let retryNumber = 0;
    while (true) {
      await waitForProvider(cfg.provider);
      let result: LLMResult;
      if (cfg.provider === "gemini") result = await callGemini(cfg, messages, opts);
      else if (cfg.provider === "minimax") result = await callMiniMax(cfg, messages, opts);
      else result = await callOpenAICompat(cfg, messages, opts);

      // A successful HTTP response with no usable JSON is model-specific and
      // should fall through to the next model instead of reaching agent code.
      if (!result.error && !result.text.trim()) {
        result = {
          ...result,
          error: "Invalid JSON: model returned an empty response.",
        };
      } else if (!result.error && opts.jsonMode && !parseJsonFromLLM(result.text)) {
        result = {
          ...result,
          error: `Invalid JSON: model returned malformed structured output: ${result.text.slice(0, 300)}`,
        };
      }

      auditAttempt(result, opts);
      totalLatency += result.latency_ms;
      recordCircuitOutcome(cfg.provider, /HTTP (429|503)\b/i.test(result.error));

      if (!result.error) {
        // Deliberately separate from the attempt audit: this is the durable
        // record of the model that won the fallback race.
        appendAudit({
          session_id: opts.sessionId,
          provider: result.provider,
          model: result.model,
          agent: opts.agentLabel,
          request_status: "OK",
          latency_ms: result.latency_ms,
        });
        return { ...result, latency_ms: totalLatency };
      }

      lastError = result;

      const transient = isTransientError(result.error);
      const noRetry = isNoRetryError(result.error);
      if (transient && !noRetry && retryNumber < retries) {
        const wait = result.retry_after_ms ?? jitteredBackoff(retryNumber);
        retryNumber += 1;
        await sleep(wait);
        continue;
      }

      // Auth, invalid-model, missing-key, invalid JSON, and other permanent
      // model-specific errors move on immediately. Exhausted transient errors
      // get a short pause before trying the next provider/model.
      if (transient && pending.length > 0) await sleep(MODEL_SWITCH_DELAY);
      break;
    }
  }

  const error = lastError?.error ?? "All models in the fallback chain failed.";
  return {
    text: "",
    latency_ms: totalLatency || lastError?.latency_ms || 0,
    provider: "chain-failed",
    model: "none",
    error,
  };
}

/** Parse JSON from an LLM response, tolerating markdown code fences. */
export function parseJsonFromLLM<T = any>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";
  if (firstObj >= 0 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj;
    open = "{";
    close = "}";
  } else if (firstArr >= 0) {
    start = firstArr;
    open = "[";
    close = "]";
  }
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === open[0]) depth++;
        else if (c === close[0]) {
          depth--;
          if (depth === 0) {
            s = s.slice(start, i + 1);
            break;
          }
        }
      }
    }
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
