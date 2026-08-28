// providers/marketdata.js — Twelve Data. Real data or DATA_UNAVAILABLE. Never invented.
import { getSecret, isTestMode, loadRegistry } from '../config.js';
import { safeFetch, nowIso } from '../util.js';
import { audit } from '../db.js';

const BASE = 'https://api.twelvedata.com';

const TF_MAP = { '1M': '1min', '5M': '5min', '15M': '15min', '30M': '30min', '1H': '1h', '4H': '4h', '1D': '1day', '1W': '1week' };

export function mapSymbol(symbol) {
  const reg = loadRegistry();
  const s = reg.symbols?.[symbol];
  return s ? { ok: true, providerSymbol: s.twelvedata, type: s.type } : { ok: false, error: `Symbol "${symbol}" has no Twelve Data mapping configured. Add it in Settings.` };
}

/**
 * Fetch OHLC time series. Returns:
 *  { status:'OK', source, symbol, interval, fetched_at, candles:[{datetime,open,high,low,close,volume?}], meta }
 *  or { status:'DATA_UNAVAILABLE', provider:'twelvedata', reason, affected }
 */
export async function fetchTimeSeries(symbol, timeframe, outputsize = 120, sessionId = null) {
  const provider = 'twelvedata';
  if (isTestMode()) {
    return { status: 'DATA_UNAVAILABLE', provider, reason: 'TEST_MODE enabled — live market data intentionally not fetched. TEST DATA only.', affected: ['price', 'indicators', 'volume'], test_data: true };
  }
  const key = getSecret('TWELVE_DATA_API_KEY');
  if (!key) return { status: 'DATA_UNAVAILABLE', provider, reason: 'TWELVE_DATA_API_KEY NOT CONFIGURED', affected: ['price', 'indicators', 'volume'] };

  const m = mapSymbol(symbol);
  if (!m.ok) return { status: 'DATA_UNAVAILABLE', provider, reason: m.error, affected: ['price'] };
  const interval = TF_MAP[timeframe];
  if (!interval) return { status: 'DATA_UNAVAILABLE', provider, reason: `Timeframe "${timeframe}" not supported for market data requests`, affected: ['price'] };

  const url = `${BASE}/time_series?symbol=${encodeURIComponent(m.providerSymbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${encodeURIComponent(key)}`;
  const res = await safeFetch(url, {}, { timeoutMs: 20000, retries: 2 });
  audit({ session_id: sessionId, provider, action: `time_series ${symbol} ${interval}`, status: res.ok && res.json?.status !== 'error' ? 'ok' : 'error', latency_ms: res.latency_ms, data_source: 'twelvedata', error: res.ok ? (res.json?.status === 'error' ? res.json?.message : null) : res.error });

  if (!res.ok) return { status: 'DATA_UNAVAILABLE', provider, reason: res.error, affected: ['price', 'indicators', 'volume'] };
  if (res.json?.status === 'error') {
    return { status: 'DATA_UNAVAILABLE', provider, reason: `Twelve Data error: ${res.json.message || 'unknown'}`, affected: ['price', 'indicators', 'volume'] };
  }
  const values = res.json?.values;
  if (!Array.isArray(values) || values.length === 0) {
    return { status: 'DATA_UNAVAILABLE', provider, reason: 'Twelve Data returned no candles for this symbol/timeframe', affected: ['price'] };
  }
  const candles = values.map(v => ({
    datetime: v.datetime,
    open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
    volume: v.volume !== undefined && v.volume !== null && v.volume !== '' ? Number(v.volume) : null,
  })).reverse(); // oldest -> newest

  const hasVolume = candles.some(c => c.volume !== null && c.volume > 0);
  return {
    status: 'OK',
    source: 'Twelve Data',
    provider,
    symbol,
    provider_symbol: m.providerSymbol,
    interval: timeframe,
    fetched_at: nowIso(),
    latest: candles[candles.length - 1],
    candles,
    volume_type: hasVolume ? (m.type === 'forex' || m.type === 'metal' ? 'TICK_VOLUME_OR_PROVIDER_AGGREGATE' : 'PROVIDER_REPORTED') : 'UNAVAILABLE',
    volume_note: hasVolume
      ? 'FX/metals are OTC: any volume from this feed is NOT centralized exchange volume. Treat as tick/provider volume.'
      : 'No volume data returned by provider for this symbol/timeframe.',
    meta: res.json.meta || null,
  };
}

/** Latest quote for a symbol. */
export async function fetchQuote(symbol, sessionId = null) {
  const provider = 'twelvedata';
  if (isTestMode()) return { status: 'DATA_UNAVAILABLE', provider, reason: 'TEST_MODE enabled — live quotes not fetched.', test_data: true };
  const key = getSecret('TWELVE_DATA_API_KEY');
  if (!key) return { status: 'DATA_UNAVAILABLE', provider, reason: 'TWELVE_DATA_API_KEY NOT CONFIGURED' };
  const m = mapSymbol(symbol);
  if (!m.ok) return { status: 'DATA_UNAVAILABLE', provider, reason: m.error };
  const url = `${BASE}/quote?symbol=${encodeURIComponent(m.providerSymbol)}&apikey=${encodeURIComponent(key)}`;
  const res = await safeFetch(url, {}, { timeoutMs: 15000, retries: 1 });
  audit({ session_id: sessionId, provider, action: `quote ${symbol}`, status: res.ok && res.json?.status !== 'error' ? 'ok' : 'error', latency_ms: res.latency_ms, data_source: 'twelvedata', error: res.ok ? (res.json?.status === 'error' ? res.json?.message : null) : res.error });
  if (!res.ok) return { status: 'DATA_UNAVAILABLE', provider, reason: res.error };
  if (res.json?.status === 'error') return { status: 'DATA_UNAVAILABLE', provider, reason: res.json.message || 'unknown error' };
  return { status: 'OK', source: 'Twelve Data', fetched_at: nowIso(), quote: res.json };
}

/** Simple health probe using a lightweight endpoint. */
export async function healthProbe() {
  const key = getSecret('TWELVE_DATA_API_KEY');
  if (!key) return { configured: false, reachable: null, auth_valid: null, error: 'TWELVE_DATA_API_KEY NOT CONFIGURED' };
  const res = await safeFetch(`${BASE}/api_usage?apikey=${encodeURIComponent(key)}`, {}, { timeoutMs: 12000, retries: 0 });
  if (!res.ok) return { configured: true, reachable: false, auth_valid: null, latency_ms: res.latency_ms, error: res.error };
  if (res.json?.status === 'error') {
    const authFail = /api key|apikey|auth/i.test(res.json.message || '');
    return { configured: true, reachable: true, auth_valid: !authFail, latency_ms: res.latency_ms, error: res.json.message };
  }
  return { configured: true, reachable: true, auth_valid: true, latency_ms: res.latency_ms, detail: res.json };
}
