// Unified LLM client for NVIDIA (OpenAI-compatible), OpenRouter (OpenAI-compatible),
// and Google Gemini (native REST). Structured JSON output, image input, retries,
// timeout, error handling — no fake responses.
import "server-only";
import { getEnv } from "./env";
import { appendAudit } from "./db";
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
}

const DEFAULT_TIMEOUT = 90_000;
const MAX_RETRIES = 2;

function toDataUrl(mime: string, b64: string) {
  return `data:${mime};base64,${b64}`;
}

export function imagePartFromBase64(b64: string, mime: string): ContentPart {
  return { type: "image_url", image_url: { url: toDataUrl(mime, b64) } };
}

/** Call an OpenAI-compatible endpoint (NVIDIA or OpenRouter). */
async function callOpenAICompat(
  cfg: ModelConfig,
  messages: LLMMessage[],
  opts: LLMCallOptions
): Promise<LLMResult> {
  const key = getEnv(cfg.api_key_env as any);
  if (!key) {
    return {
      text: "",
      latency_ms: 0,
      provider: cfg.provider,
      model: cfg.model_id,
      error: `Missing API key for ${cfg.provider} (env ${cfg.api_key_env})`,
    };
  }
  if (!cfg.base_url) {
    return {
      text: "",
      latency_ms: 0,
      provider: cfg.provider,
      model: cfg.model_id,
      error: `No base URL configured for provider ${cfg.provider}.`,
    };
  }
  const url = `${cfg.base_url.replace(/\/$/, "")}/chat/completions`;
  const body: any = {
    model: cfg.model_id,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://trading-ai-ak.local";
    headers["X-Title"] = "Trading AI AK";
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
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
    clearTimeout(t);
    const err = e?.name === "AbortError" ? "request timeout" : String(e?.message ?? e);
    return {
      text: "",
      latency_ms: Date.now() - start,
      provider: cfg.provider,
      model: cfg.model_id,
      error: `Network error: ${err}`,
    };
  }
  clearTimeout(t);
  const latency = Date.now() - start;
  const text = await resp.text();
  if (!resp.ok) {
    return {
      text: "",
      latency_ms: latency,
      provider: cfg.provider,
      model: cfg.model_id,
      error: `HTTP ${resp.status}: ${text.slice(0, 500)}`,
    };
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      text: "",
      latency_ms: latency,
      provider: cfg.provider,
      model: cfg.model_id,
      error: `Invalid JSON: ${text.slice(0, 300)}`,
    };
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
    return {
      text: "",
      latency_ms: 0,
      provider: "gemini",
      model: cfg.model_id,
      error: `Missing API key for Gemini (env ${cfg.api_key_env})`,
    };
  }
  const contents: any[] = [];
  let systemInstruction: any = undefined;
  for (const m of messages) {
    if (m.role === "system") {
      systemInstruction = {
        parts: [{ text: typeof m.content === "string" ? m.content : "" }],
      };
      continue;
    }
    const parts: any[] = [];
    if (typeof m.content === "string") {
      parts.push({ text: m.content });
    } else {
      for (const p of m.content) {
        if (p.type === "text") parts.push({ text: p.text });
        else if (p.type === "image_url") {
          // data:image/png;base64,XXXX -> inlineData
          const u = p.image_url.url;
          const match = /^data:([^;]+);base64,(.+)$/.exec(u);
          if (match) {
            parts.push({
              inline_data: { mime_type: match[1], data: match[2] },
            });
          }
        }
      }
    }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  const genConfig: any = {
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxTokens ?? 2048,
  };
  if (opts.jsonMode) {
    genConfig.responseMimeType = "application/json";
  }
  const url = `${cfg.base_url}/models/${encodeURIComponent(
    cfg.model_id
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const body: any = { contents, generationConfig: genConfig };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
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
    clearTimeout(t);
    const err = e?.name === "AbortError" ? "request timeout" : String(e?.message ?? e);
    return {
      text: "",
      latency_ms: Date.now() - start,
      provider: "gemini",
      model: cfg.model_id,
      error: `Network error: ${err}`,
    };
  }
  clearTimeout(t);
  const latency = Date.now() - start;
  const txt = await resp.text();
  if (!resp.ok) {
    return {
      text: "",
      latency_ms: latency,
      provider: "gemini",
      model: cfg.model_id,
      error: `HTTP ${resp.status}: ${txt.slice(0, 500)}`,
    };
  }
  let data: any;
  try {
    data = JSON.parse(txt);
  } catch {
    return {
      text: "",
      latency_ms: latency,
      provider: "gemini",
      model: cfg.model_id,
      error: `Invalid JSON: ${txt.slice(0, 300)}`,
    };
  }
  // Gemini response shape: candidates[0].content.parts[0].text
  const outText =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  return {
    text: outText,
    latency_ms: latency,
    provider: "gemini",
    model: cfg.model_id,
  };
}

/**
 * MiniMax direct endpoint is NOT documented/invented here. If user configures a
 * base_url for minimax, we attempt OpenAI-compatible chat; otherwise we fail
 * loudly so the caller can fall back to NVIDIA/OpenRouter.
 */
async function callMiniMax(
  cfg: ModelConfig,
  messages: LLMMessage[],
  opts: LLMCallOptions
): Promise<LLMResult> {
  if (!cfg.base_url) {
    return {
      text: "",
      latency_ms: 0,
      provider: "minimax",
      model: cfg.model_id,
      error:
        "Direct MiniMax endpoint NOT configured. The provided MiniMax key looks like an NVIDIA-issued token; route MiniMax through NVIDIA.",
    };
  }
  return callOpenAICompat(cfg, messages, opts);
}

export async function callLLM(
  cfg: ModelConfig | null,
  messages: LLMMessage[],
  opts: LLMCallOptions = {}
): Promise<LLMResult> {
  if (!cfg) {
    return {
      text: "",
      latency_ms: 0,
      provider: "none",
      model: "none",
      error: "No model configured",
    };
  }
  const retries = opts.retries ?? MAX_RETRIES;
  let lastErr: LLMResult | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: LLMResult;
    if (cfg.provider === "gemini") res = await callGemini(cfg, messages, opts);
    else if (cfg.provider === "minimax") res = await callMiniMax(cfg, messages, opts);
    else res = await callOpenAICompat(cfg, messages, opts);

    appendAudit({
      session_id: opts.sessionId,
      provider: res.provider,
      model: res.model,
      agent: opts.agentLabel,
      request_status: res.error ? "ERROR" : "OK",
      latency_ms: res.latency_ms,
      error: res.error,
    });

    if (!res.error) return res;
    lastErr = res;
    // Don't retry on auth errors (401/403) or invalid model
    if (/HTTP 401|HTTP 403|Missing API key|Invalid JSON/i.test(res.error)) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return (
    lastErr ?? {
      text: "",
      latency_ms: 0,
      provider: cfg.provider,
      model: cfg.model_id,
      error: "Unknown error",
    }
  );
}

/** Parse JSON from an LLM response, tolerating markdown code fences. */
export function parseJsonFromLLM<T = any>(text: string): T | null {
  if (!text) return null;
  // Strip ```json fences
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Find first { or [ and last matching } or ]
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
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
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
