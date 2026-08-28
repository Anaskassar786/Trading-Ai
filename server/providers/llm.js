// providers/llm.js — server-side LLM access. Keys NEVER leave this process.
import { getSecret, isTestMode } from '../config.js';
import { safeFetch, extractJson } from '../util.js';
import { audit } from '../db.js';

const modelListCache = new Map(); // provider base_url -> { ts, ids:Set } (10 min TTL)

/**
 * Validate that a provider actually accepts a model id (OpenAI-compatible /models,
 * Gemini ListModels). Returns { ok, valid, error }.
 */
export async function validateModel(model) {
  if (isTestMode()) return { ok: true, valid: true, error: null, note: 'TEST_MODE — validation skipped, mock responses only' };
  const p = model.provider_config;
  const key = getSecret(p.key_env);
  if (!key) return { ok: false, valid: false, error: `${p.key_env} NOT CONFIGURED` };
  if (!model.model_id) return { ok: false, valid: false, error: 'model_id NOT CONFIGURED' };

  const cacheKey = `${p.type}|${p.base_url}`;
  const cached = modelListCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
    return { ok: true, valid: cached.ids.has(model.model_id), error: cached.ids.has(model.model_id) ? null : `Model "${model.model_id}" not in provider model list` };
  }

  let res;
  if (p.type === 'gemini') {
    res = await safeFetch(`${p.base_url}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': key },
    }, { timeoutMs: 15000, retries: 1 });
    if (!res.ok) return { ok: false, valid: false, error: res.error };
    const ids = new Set((res.json?.models || []).map(m => String(m.name || '').replace(/^models\//, '')));
    modelListCache.set(cacheKey, { ts: Date.now(), ids });
    const valid = ids.has(model.model_id);
    return { ok: true, valid, error: valid ? null : `Model "${model.model_id}" not in Gemini model list` };
  }

  res = await safeFetch(`${p.base_url}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  }, { timeoutMs: 15000, retries: 1 });
  if (!res.ok) return { ok: false, valid: false, error: res.error };
  const ids = new Set((res.json?.data || []).map(m => m.id));
  modelListCache.set(cacheKey, { ts: Date.now(), ids });
  const valid = ids.has(model.model_id);
  return { ok: true, valid, error: valid ? null : `Model "${model.model_id}" not in provider model list` };
}

/**
 * chatCompletion — one real model call.
 * messages: [{role, content}] where content is string OR array of parts
 *   [{type:'text', text}, {type:'image', mime, dataBase64}]
 * Returns { ok, text?, json?, error?, provider, model_id, latency_ms }.
 */
export async function chatCompletion(model, messages, opts = {}) {
  const { temperature = model.temperature ?? 0.2, maxTokens = 4096, expectJson = false, sessionId = null, agentLabel = null, timeoutMs = 120000 } = opts;
  const p = model.provider_config;
  const key = getSecret(p.key_env);
  const meta = { provider: model.provider, model_id: model.model_id };

  if (isTestMode()) {
    return testModeCompletion(model, messages, expectJson, meta);
  }
  if (!key) return { ...meta, ok: false, error: `${p.key_env} NOT CONFIGURED` };
  if (!model.model_id) return { ...meta, ok: false, error: 'model_id NOT CONFIGURED' };

  const hasImage = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image'));
  if (hasImage && !model.supports_image) {
    return { ...meta, ok: false, error: 'IMAGE_ANALYSIS_UNAVAILABLE: selected model does not support image input' };
  }

  let res, text;
  if (p.type === 'gemini') {
    const body = geminiBody(messages, temperature, maxTokens, expectJson);
    res = await safeFetch(`${p.base_url}/models/${encodeURIComponent(model.model_id)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    }, { timeoutMs, retries: 2 });
    text = res.json?.candidates?.[0]?.content?.parts?.map(pt => pt.text || '').join('') ?? null;
  } else {
    const body = {
      model: model.model_id,
      temperature,
      max_tokens: maxTokens,
      messages: messages.map(m => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.map(c => c.type === 'image'
              ? { type: 'image_url', image_url: { url: `data:${c.mime};base64,${c.dataBase64}` } }
              : { type: 'text', text: c.text })
          : m.content,
      })),
    };
    if (expectJson && model.supports_structured_output) body.response_format = { type: 'json_object' };
    res = await safeFetch(`${p.base_url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }, { timeoutMs, retries: 2 });
    const msg = res.json?.choices?.[0]?.message;
    text = msg?.content ?? null;
    // Some reasoning models put final content after reasoning; content may be empty string.
    if ((!text || !text.trim()) && msg?.reasoning_content) text = msg.reasoning_content;
  }

  audit({
    session_id: sessionId, provider: model.provider, model: model.model_id, agent: agentLabel,
    action: 'llm_chat', status: res.ok ? 'ok' : 'error', latency_ms: res.latency_ms, error: res.ok ? null : res.error,
  });

  if (!res.ok) return { ...meta, ok: false, error: res.error, latency_ms: res.latency_ms };
  if (text === null || text === undefined || !String(text).trim()) {
    return { ...meta, ok: false, error: 'Provider returned empty completion', latency_ms: res.latency_ms };
  }
  const out = { ...meta, ok: true, text: String(text), latency_ms: res.latency_ms };
  if (expectJson) {
    out.json = extractJson(out.text);
    if (!out.json) { out.ok = false; out.error = 'Model output was not valid JSON matching the required schema'; }
  }
  return out;
}

function geminiBody(messages, temperature, maxTokens, expectJson) {
  const sys = messages.filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('\n'))).join('\n\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: Array.isArray(m.content)
      ? m.content.map(c => c.type === 'image'
          ? { inline_data: { mime_type: c.mime, data: c.dataBase64 } }
          : { text: c.text })
      : [{ text: m.content }],
  }));
  const body = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  if (expectJson) body.generationConfig.responseMimeType = 'application/json';
  return body;
}

// ---------------- TEST MODE (explicit, clearly labelled, never used in production) ----------------
function testModeCompletion(model, messages, expectJson, meta) {
  const label = 'TEST DATA — mock LLM response (TEST_MODE=true). Not a real model output.';
  if (!expectJson) return { ...meta, ok: true, text: label, test_data: true, latency_ms: 1 };
  const lastUser = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join(' ')).join(' ');
  // Deterministic mock decision so acceptance tests are repeatable; explicitly flagged.
  const json = {
    decision: 'NO_TRADE',
    confidence: 0,
    evidence: [label],
    supporting_factors: [],
    contradicting_factors: [],
    entry_zone: { low: null, high: null },
    stop_loss: null, take_profit_1: null, take_profit_2: null, take_profit_3: null,
    risk_reward: null,
    invalidation_conditions: [],
    data_quality: 'INSUFFICIENT',
    warnings: [label],
    // Extra fields so debate/judge schemas can also be exercised in TEST_MODE:
    final_decision: 'NO_TRADE', final_confidence: 0, entry: { low: null, high: null },
    targets: { tp1: null, tp2: null, tp3: null }, decision_summary: label,
    strongest_bullish_arguments: [], strongest_bearish_arguments: [], rejected_arguments: [],
    why_not_opposite: label, timeframe_alignment: label,
    challenge: label, counterclaim: label, assessment: 'UNRESOLVED — TEST DATA', winner: 'UNRESOLVED',
    confidence_change: { challenger_delta: 0, challenged_delta: 0 },
    test_data: true,
    _prompt_bytes: lastUser.length,
  };
  return { ...meta, ok: true, text: JSON.stringify(json), json, test_data: true, latency_ms: 1 };
}
