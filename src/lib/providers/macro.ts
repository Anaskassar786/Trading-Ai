// FRED macroeconomic data client.
// NOT a gold price feed. We fetch a small curated set of series relevant to
// gold/FX: DGS10 (10Y Treasury yield), DFF (Fed Funds effective rate),
// T5YIE (5Y breakeven inflation), DTWEXBGS (trade-weighted USD index), DEXUSEU (USD/EUR), VIXCLS.
import "server-only";
import { getEnv } from "../env";
import { appendAudit } from "../db";
import type { MacroSnapshot, MacroSeries, Instrument } from "../types";

const SERIES_SET: { id: string; title: string; gold: boolean; forex: boolean }[] = [
  { id: "DGS10", title: "10-Year Treasury Yield", gold: true, forex: true },
  { id: "DFF", title: "Fed Funds Effective Rate", gold: true, forex: true },
  { id: "T5YIE", title: "5-Year Breakeven Inflation", gold: true, forex: true },
  { id: "DTWEXBGS", title: "Trade Weighted USD Index (Broad)", gold: true, forex: true },
  { id: "VIXCLS", title: "CBOE VIX", gold: true, forex: true },
];

function pickSeries(instrument: Instrument) {
  return SERIES_SET.filter((s) =>
    instrument.assetClass === "GOLD" ? s.gold : s.forex
  );
}

export async function fetchMacro(
  instrument: Instrument,
  sessionId?: string
): Promise<MacroSnapshot> {
  const key = getEnv("FRED_API_KEY");
  const start = Date.now();
  const audit = (status: "OK" | "ERROR", err?: string) =>
    appendAudit({
      session_id: sessionId,
      provider: "fred",
      request_status: status,
      latency_ms: Date.now() - start,
      data_source: "fred",
      error: err,
    });
  if (!key) {
    audit("ERROR", "Missing FRED_API_KEY");
    return { status: "DATA_UNAVAILABLE", error: "FRED API key not configured." };
  }
  const series = pickSeries(instrument);
  const results: MacroSeries[] = [];
  let anyOk = false;
  let firstErr: string | undefined;

  for (const s of series) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}` +
      `&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=20`;
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(to);
      const txt = await r.text();
      if (!r.ok) {
        firstErr = firstErr ?? `FRED ${s.id} HTTP ${r.status}`;
        continue;
      }
      const j = JSON.parse(txt);
      const obs: any[] = Array.isArray(j?.observations) ? j.observations : [];
      const points = obs
        .filter((o) => o.value !== "." && o.value != null)
        .map((o) => ({ date: o.date, value: Number(o.value) }))
        .reverse();
      if (points.length === 0) continue;
      results.push({
        seriesId: s.id,
        title: s.title,
        points,
        latest: points[points.length - 1],
      });
      anyOk = true;
    } catch (e: any) {
      firstErr = firstErr ?? String(e?.message ?? e);
    }
  }
  if (!anyOk) {
    audit("ERROR", firstErr || "No macro series fetched");
    return { status: "DATA_UNAVAILABLE", error: firstErr ?? "No macro data." };
  }
  audit("OK");
  return { status: "OK", series: results, fetchedAt: new Date().toISOString() };
}

export async function validateFred(): Promise<{
  ok: boolean;
  latency_ms: number;
  error?: string;
}> {
  const key = getEnv("FRED_API_KEY");
  if (!key) return { ok: false, latency_ms: 0, error: "Missing API key" };
  const start = Date.now();
  try {
    const url =
      `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${encodeURIComponent(key)}&file_type=json&limit=1`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    const txt = await r.text();
    if (!r.ok) return { ok: false, latency_ms: Date.now() - start, error: `HTTP ${r.status}: ${txt.slice(0,200)}` };
    const j = JSON.parse(txt);
    if (j?.error_code || !Array.isArray(j?.observations))
      return { ok: false, latency_ms: Date.now() - start, error: j?.error_message || "bad response" };
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: String(e?.message ?? e) };
  }
}
