// services/health.js — REAL health checks. PASS/FAIL from actual requests only.
// A provider is never marked connected just because a key exists.
import { getSecret, loadRegistry } from '../config.js';
import { safeFetch, nowIso } from '../util.js';
import db from '../db.js';
import * as md from '../providers/marketdata.js';
import * as fred from '../providers/fred.js';
import * as news from '../providers/news.js';

async function llmProbe(providerName) {
  const reg = loadRegistry();
  const p = reg.providers[providerName];
  if (!p) return { configured: false, error: 'Provider not in registry' };
  const key = getSecret(p.key_env);
  const base = { configured: !!key, reachable: null, auth_valid: null, model_valid: null };
  if (!key) return { ...base, error: `${p.key_env} NOT CONFIGURED` };
  if (!p.base_url) return { ...base, error: 'Base URL NOT CONFIGURED (e.g. MiniMax direct endpoint not set — MiniMax models are routed via NVIDIA/OpenRouter).' };

  const configuredModels = reg.models.filter(m => m.provider === providerName && m.enabled && m.model_id).map(m => m.model_id);

  if (p.type === 'gemini') {
    const res = await safeFetch(`${p.base_url}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, { timeoutMs: 12000, retries: 0 });
    if (!res.ok) return { ...base, reachable: res.status > 0, auth_valid: res.status === 401 || res.status === 403 ? false : null, latency_ms: res.latency_ms, error: res.error };
    const ids = new Set((res.json?.models || []).map(m => String(m.name || '').replace(/^models\//, '')));
    const missing = configuredModels.filter(m => !ids.has(m));
    return { ...base, reachable: true, auth_valid: true, model_valid: configuredModels.length ? missing.length === 0 : null, latency_ms: res.latency_ms, detail: missing.length ? `Configured model(s) not found: ${missing.join(', ')}` : `${ids.size} models available`, error: missing.length ? `Model(s) not accepted: ${missing.join(', ')}` : null };
  }

  const res = await safeFetch(`${p.base_url}/models`, { headers: { Authorization: `Bearer ${key}` } }, { timeoutMs: 12000, retries: 0 });
  if (!res.ok) return { ...base, reachable: res.status > 0, auth_valid: res.status === 401 || res.status === 403 ? false : null, latency_ms: res.latency_ms, error: res.error };
  const ids = new Set((res.json?.data || []).map(m => m.id));
  const missing = configuredModels.filter(m => !ids.has(m));
  return { ...base, reachable: true, auth_valid: true, model_valid: configuredModels.length ? missing.length === 0 : null, latency_ms: res.latency_ms, detail: missing.length ? `Configured model(s) not found: ${missing.join(', ')}` : `${ids.size} models available`, error: missing.length ? `Model(s) not accepted: ${missing.join(', ')}` : null };
}

const PROBES = {
  nvidia: () => llmProbe('nvidia'),
  openrouter: () => llmProbe('openrouter'),
  gemini: () => llmProbe('gemini'),
  'minimax-direct': () => llmProbe('minimax-direct'),
  twelvedata: () => md.healthProbe(),
  fred: () => fred.healthProbe(),
  newsapi: () => news.healthProbe(),
};

export async function checkAll() {
  const results = {};
  await Promise.all(Object.entries(PROBES).map(async ([name, probe]) => {
    let r;
    try { r = await probe(); } catch (e) { r = { configured: null, error: `Probe crashed: ${e.message}` }; }
    const pass = r.configured === true && r.reachable === true && r.auth_valid === true && r.model_valid !== false;
    results[name] = { ...r, status: r.configured === false ? 'NOT CONFIGURED' : pass ? 'PASS' : 'FAIL', checked_at: nowIso() };
    persist(name, results[name]);
  }));
  return results;
}

function persist(provider, r) {
  const prev = db.prepare('SELECT last_success FROM api_health WHERE provider=?').get(provider);
  db.prepare(`INSERT INTO api_health (provider,last_check,configured,reachable,auth_valid,model_valid,latency_ms,last_success,last_error,detail)
              VALUES (@provider,@last_check,@configured,@reachable,@auth_valid,@model_valid,@latency_ms,@last_success,@last_error,@detail)
              ON CONFLICT(provider) DO UPDATE SET last_check=@last_check,configured=@configured,reachable=@reachable,auth_valid=@auth_valid,
                model_valid=@model_valid,latency_ms=@latency_ms,last_success=@last_success,last_error=@last_error,detail=@detail`)
    .run({
      provider,
      last_check: r.checked_at,
      configured: r.configured === true ? 1 : r.configured === false ? 0 : null,
      reachable: r.reachable === true ? 1 : r.reachable === false ? 0 : null,
      auth_valid: r.auth_valid === true ? 1 : r.auth_valid === false ? 0 : null,
      model_valid: r.model_valid === true ? 1 : r.model_valid === false ? 0 : null,
      latency_ms: r.latency_ms ?? null,
      last_success: r.status === 'PASS' ? r.checked_at : (prev?.last_success ?? null),
      last_error: r.error ? String(r.error).slice(0, 500) : null,
      detail: r.detail ? String(r.detail).slice(0, 500) : null,
    });
}

export function lastKnown() {
  const rows = db.prepare('SELECT * FROM api_health').all();
  const out = {};
  for (const r of rows) out[r.provider] = r;
  return out;
}
