// providers/news.js — News API (newsapi.org). Only real returned articles are ever shown.
import { getSecret, isTestMode } from '../config.js';
import { safeFetch, nowIso } from '../util.js';
import { audit } from '../db.js';

const BASE = 'https://newsapi.org';

const GOLD_TERMS = ['gold price', 'XAUUSD', 'Federal Reserve', 'US Dollar', 'Treasury yields', 'inflation CPI', 'interest rates', 'geopolitical risk'];

function termsForSymbol(symbol, instrumentType) {
  if (instrumentType === 'metal' || /XAU|XAG/.test(symbol)) return GOLD_TERMS;
  const ccyNames = { EUR: 'euro ECB', GBP: 'pound sterling Bank of England', JPY: 'yen Bank of Japan', USD: 'US dollar Federal Reserve', AUD: 'Australian dollar RBA', CAD: 'Canadian dollar Bank of Canada', CHF: 'Swiss franc SNB', NZD: 'New Zealand dollar RBNZ' };
  const parts = symbol.split('/').map(s => s.trim().toUpperCase());
  const terms = [symbol.replace('/', '')];
  for (const p of parts) if (ccyNames[p]) terms.push(ccyNames[p]);
  terms.push('interest rates', 'inflation CPI', 'central bank');
  return terms;
}

/**
 * News snapshot for a symbol. Real articles only, each with headline/source/time/url.
 */
export async function fetchNewsSnapshot(symbol, instrumentType, sessionId = null) {
  const provider = 'newsapi';
  if (isTestMode()) return { status: 'DATA_UNAVAILABLE', provider, reason: 'TEST_MODE enabled — live news not fetched.', test_data: true, articles: [] };
  const key = getSecret('NEWS_API_KEY');
  if (!key) return { status: 'DATA_UNAVAILABLE', provider, reason: 'NEWS_API_KEY NOT CONFIGURED', articles: [] };

  const terms = termsForSymbol(symbol, instrumentType);
  const q = terms.slice(0, 6).map(t => `"${t}"`).join(' OR ');
  const from = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url = `${BASE}/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=25&from=${from}`;
  const res = await safeFetch(url, { headers: { 'X-Api-Key': key } }, { timeoutMs: 15000, retries: 1 });
  audit({ session_id: sessionId, provider, action: 'everything', status: res.ok && res.json?.status === 'ok' ? 'ok' : 'error', latency_ms: res.latency_ms, data_source: 'newsapi', error: res.ok ? (res.json?.status !== 'ok' ? res.json?.message : null) : res.error });

  if (!res.ok) return { status: 'DATA_UNAVAILABLE', provider, reason: res.error, articles: [] };
  if (res.json?.status !== 'ok') return { status: 'DATA_UNAVAILABLE', provider, reason: `News API error: ${res.json?.code || ''} ${res.json?.message || 'unknown'}`, articles: [] };

  const articles = (res.json.articles || []).map(a => ({
    headline: a.title,
    source: a.source?.name || null,
    published_at: a.publishedAt || null,
    url: a.url || null,
    description: a.description ? String(a.description).slice(0, 400) : null,
  })).filter(a => a.headline);

  return {
    status: 'OK',
    provider,
    source: 'News API (newsapi.org)',
    query_terms: terms,
    fetched_at: nowIso(),
    total_results: res.json.totalResults ?? articles.length,
    articles,
  };
}

export async function healthProbe() {
  const key = getSecret('NEWS_API_KEY');
  if (!key) return { configured: false, reachable: null, auth_valid: null, error: 'NEWS_API_KEY NOT CONFIGURED' };
  const res = await safeFetch(`${BASE}/v2/top-headlines?category=business&pageSize=1&language=en`, { headers: { 'X-Api-Key': key } }, { timeoutMs: 12000, retries: 0 });
  if (!res.ok) return { configured: true, reachable: res.status > 0, auth_valid: res.status === 401 ? false : null, latency_ms: res.latency_ms, error: res.error };
  if (res.json?.status !== 'ok') return { configured: true, reachable: true, auth_valid: false, latency_ms: res.latency_ms, error: res.json?.message };
  return { configured: true, reachable: true, auth_valid: true, latency_ms: res.latency_ms };
}
