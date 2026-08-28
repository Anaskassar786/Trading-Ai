// Twelve Data market data client. No fabricated data.
import "server-only";
import { getEnv } from "../env";
import { appendAudit } from "../db";
import type { MarketSnapshot, PriceCandle, Timeframe } from "../types";

// Twelve Data uses specific interval strings. Map our internal TFs.
const TF_MAP: Record<Timeframe, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
};

// Best-effort symbol mapping. We attempt the obvious; if 404/no-data, DATA_UNAVAILABLE.
function normalizeSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  // Twelve Data supports "XAU/USD" for gold (verification handled at runtime)
  // and standard forex pairs like "EUR/USD".
  return s;
}

export async function fetchMarketData(
  symbol: string,
  tf: Timeframe,
  sessionId?: string,
  maxBars = 200
): Promise<MarketSnapshot> {
  const key = getEnv("TWELVE_DATA_API_KEY");
  const start = Date.now();
  const sym = normalizeSymbol(symbol);
  const interval = TF_MAP[tf];
  const audit = (status: "OK" | "ERROR", err?: string) =>
    appendAudit({
      session_id: sessionId,
      provider: "twelvedata",
      request_status: status,
      latency_ms: Date.now() - start,
      data_source: "twelvedata",
      error: err,
    });

  if (!key) {
    audit("ERROR", "Missing TWELVE_DATA_API_KEY");
    return {
      status: "DATA_UNAVAILABLE",
      symbol,
      timeframe: tf,
      error: "Twelve Data API key not configured.",
    };
  }
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}` +
    `&interval=${interval}&outputsize=${maxBars}&format=JSON&apikey=${encodeURIComponent(key)}`;

  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    const txt = await r.text();
    if (!r.ok) {
      audit("ERROR", `HTTP ${r.status}: ${txt.slice(0, 200)}`);
      return {
        status: "DATA_UNAVAILABLE",
        symbol,
        timeframe: tf,
        error: `Twelve Data HTTP ${r.status}`,
      };
    }
    let data: any;
    try {
      data = JSON.parse(txt);
    } catch {
      audit("ERROR", "Invalid JSON from Twelve Data");
      return {
        status: "DATA_UNAVAILABLE",
        symbol,
        timeframe: tf,
        error: "Invalid JSON from Twelve Data.",
      };
    }
    if (data?.status === "error" || data?.code) {
      audit("ERROR", data?.message || JSON.stringify(data).slice(0, 200));
      return {
        status: "DATA_UNAVAILABLE",
        symbol,
        timeframe: tf,
        error: `Twelve Data: ${data?.message ?? "symbol/interval not supported"}`,
        note: "Symbol/timeframe may not exist on Twelve Data — verify before relying on market data.",
      };
    }
    const values: any[] = Array.isArray(data?.values) ? data.values : [];
    if (values.length === 0) {
      audit("ERROR", "Empty values array");
      return {
        status: "DATA_UNAVAILABLE",
        symbol,
        timeframe: tf,
        error: "No candles returned.",
      };
    }
    // Twelve Data returns newest first; reverse to chronological
    const chronological = values.slice().reverse();
    const candles: PriceCandle[] = chronological.map((v) => ({
      timestamp: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: v.volume != null ? parseFloat(v.volume) : undefined,
    }));
    audit("OK");
    return {
      status: "OK",
      symbol: sym,
      timeframe: tf,
      candles,
      source: "twelvedata",
      fetchedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    const err = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
    audit("ERROR", err);
    return {
      status: "DATA_UNAVAILABLE",
      symbol,
      timeframe: tf,
      error: `Twelve Data request failed: ${err}`,
    };
  }
}

/**
 * Quick symbol validation used by health checks. Does not throw.
 */
export async function validateTwelveData(): Promise<{
  ok: boolean;
  latency_ms: number;
  error?: string;
}> {
  const key = getEnv("TWELVE_DATA_API_KEY");
  if (!key) return { ok: false, latency_ms: 0, error: "Missing API key" };
  const start = Date.now();
  try {
    // Low-cost endpoint (just 1 bar of a known working symbol) to verify auth.
    const url =
      `https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=1day&outputsize=1&apikey=${encodeURIComponent(key)}`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    const txt = await r.text();
    if (!r.ok) return { ok: false, latency_ms: Date.now() - start, error: `HTTP ${r.status}: ${txt.slice(0,200)}` };
    const j = JSON.parse(txt);
    if (j?.code === 401 || j?.status === "error") {
      return { ok: false, latency_ms: Date.now() - start, error: j?.message || "Auth error" };
    }
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: String(e?.message ?? e) };
  }
}
