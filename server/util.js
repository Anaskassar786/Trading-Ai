// util.js — shared helpers. No secrets are ever logged or returned from here.
import crypto from 'node:crypto';

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

/**
 * fetch with timeout + bounded retry + honest error reporting.
 * Returns { ok, status, json?, text?, error?, latency_ms, attempts }.
 * NEVER throws. NEVER logs Authorization headers.
 */
export async function safeFetch(url, options = {}, cfg = {}) {
  const {
    timeoutMs = 30000,
    retries = 2,
    retryOn = [429, 500, 502, 503, 504],
    retryDelayMs = 1200,
  } = cfg;

  let attempts = 0;
  let lastErr = null;
  const started = Date.now();

  while (attempts <= retries) {
    attempts++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

      if (!res.ok) {
        lastErr = `HTTP ${res.status}${json?.error?.message ? `: ${String(json.error.message).slice(0, 300)}` : json?.message ? `: ${String(json.message).slice(0, 300)}` : ''}`;
        if (retryOn.includes(res.status) && attempts <= retries) {
          await sleep(retryDelayMs * attempts);
          continue;
        }
        return { ok: false, status: res.status, json, text, error: lastErr, latency_ms: Date.now() - started, attempts };
      }
      return { ok: true, status: res.status, json, text, latency_ms: Date.now() - started, attempts };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : `Network error: ${e.message}`;
      if (attempts <= retries) { await sleep(retryDelayMs * attempts); continue; }
    }
  }
  return { ok: false, status: 0, error: lastErr, latency_ms: Date.now() - started, attempts };
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Extract the first top-level JSON object from LLM text output. Returns null if none. */
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip common markdown fences first.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start === -1) continue;
    // Walk braces to find balanced object.
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(c.slice(start, i + 1)); } catch { break; }
          }
        }
      }
    }
  }
  return null;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function round(n, dp = 5) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
