// providers/fred.js — FRED macro data. Macro series only; NOT a live gold price feed.
import { getSecret, isTestMode } from '../config.js';
import { safeFetch, nowIso } from '../util.js';
import { audit } from '../db.js';

const BASE = 'https://api.stlouisfed.org/fred';

// Macro series relevant to gold & USD-major forex position trading.
export const MACRO_SERIES = [
  { id: 'FEDFUNDS', label: 'Effective Federal Funds Rate (%)' },
  { id: 'CPIAUCSL', label: 'CPI (All Urban Consumers, Index)' },
  { id: 'PCEPILFE', label: 'Core PCE Price Index' },
  { id: 'DGS10', label: '10-Year Treasury Constant Maturity Yield (%)' },
  { id: 'DGS2', label: '2-Year Treasury Constant Maturity Yield (%)' },
  { id: 'DTWEXBGS', label: 'Trade-Weighted USD Index (Broad Goods & Services)' },
  { id: 'UNRATE', label: 'Unemployment Rate (%)' },
  { id: 'T10YIE', label: '10-Year Breakeven Inflation Rate (%)' },
];

async function fetchSeries(id, sessionId) {
  const key = getSecret('FRED_API_KEY');
  const url = `${BASE}/series/observations?series_id=${id}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=13`;
  const res = await safeFetch(url, {}, { timeoutMs: 15000, retries: 1 });
  audit({ session_id: sessionId, provider: 'fred', action: `series ${id}`, status: res.ok ? 'ok' : 'error', latency_ms: res.latency_ms, data_source: 'fred', error: res.error || null });
  if (!res.ok) return { series_id: id, status: 'DATA_UNAVAILABLE', reason: res.error };
  const obs = (res.json?.observations || []).filter(o => o.value !== '.');
  if (!obs.length) return { series_id: id, status: 'DATA_UNAVAILABLE', reason: 'No observations returned' };
  return {
    series_id: id,
    status: 'OK',
    latest: { date: obs[0].date, value: Number(obs[0].value) },
    previous: obs[1] ? { date: obs[1].date, value: Number(obs[1].value) } : null,
    year_ago: obs[12] ? { date: obs[12].date, value: Number(obs[12].value) } : null,
  };
}

/** Macro snapshot: each series independently OK or DATA_UNAVAILABLE. */
export async function fetchMacroSnapshot(sessionId = null) {
  const provider = 'fred';
  if (isTestMode()) return { status: 'DATA_UNAVAILABLE', provider, reason: 'TEST_MODE enabled — live macro data not fetched.', test_data: true, series: [] };
  const key = getSecret('FRED_API_KEY');
  if (!key) return { status: 'DATA_UNAVAILABLE', provider, reason: 'FRED_API_KEY NOT CONFIGURED', series: [] };

  const results = await Promise.all(MACRO_SERIES.map(s => fetchSeries(s.id, sessionId).then(r => ({ ...r, label: s.label }))));
  const okCount = results.filter(r => r.status === 'OK').length;
  return {
    status: okCount > 0 ? (okCount === results.length ? 'OK' : 'PARTIAL') : 'DATA_UNAVAILABLE',
    provider,
    source: 'FRED (Federal Reserve Bank of St. Louis)',
    fetched_at: nowIso(),
    reason: okCount === 0 ? 'All FRED series requests failed' : null,
    note: 'FRED values are official series with publication lag — NOT live market prices.',
    series: results,
  };
}

export async function healthProbe() {
  const key = getSecret('FRED_API_KEY');
  if (!key) return { configured: false, reachable: null, auth_valid: null, error: 'FRED_API_KEY NOT CONFIGURED' };
  const res = await safeFetch(`${BASE}/series?series_id=FEDFUNDS&api_key=${encodeURIComponent(key)}&file_type=json`, {}, { timeoutMs: 12000, retries: 0 });
  if (!res.ok) return { configured: true, reachable: res.status > 0, auth_valid: res.status === 400 || res.status === 403 ? false : null, latency_ms: res.latency_ms, error: res.error };
  return { configured: true, reachable: true, auth_valid: true, latency_ms: res.latency_ms };
}
