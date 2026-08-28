// News API client. No invented headlines.
import "server-only";
import { getEnv } from "../env";
import { appendAudit } from "../db";
import type { NewsItem, NewsSnapshot, Instrument } from "../types";

function buildQuery(instrument: Instrument): string {
  if (instrument.assetClass === "GOLD") {
    return "(gold OR XAUUSD OR XAU/USD) AND (Fed OR Federal Reserve OR dollar OR DXY OR inflation OR interest rates OR geopolitics OR yields OR CPI)";
  }
  // Forex
  const sym = instrument.symbol.toUpperCase();
  const parts = sym.split("/");
  const base = parts[0] || "";
  const quote = parts[1] || "";
  return `(${sym} OR ${base} OR ${quote}) AND (central bank OR interest rates OR inflation OR GDP OR Fed OR ECB OR BOJ) `;
}

export async function fetchNews(
  instrument: Instrument,
  sessionId?: string
): Promise<NewsSnapshot> {
  const key = getEnv("NEWS_API_KEY");
  const start = Date.now();
  const query = buildQuery(instrument);
  const audit = (status: "OK" | "ERROR", err?: string) =>
    appendAudit({
      session_id: sessionId,
      provider: "newsapi",
      request_status: status,
      latency_ms: Date.now() - start,
      data_source: "newsapi",
      error: err,
    });
  if (!key) {
    audit("ERROR", "Missing NEWS_API_KEY");
    return { status: "DATA_UNAVAILABLE", error: "News API key not configured.", queryTerms: [query] };
  }
  // Try /v2/everything first (broad search, relevant for gold/forex).
  const url =
    `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}` +
    `&language=en&sortBy=publishedAt&pageSize=15&apiKey=${encodeURIComponent(key)}`;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    const txt = await r.text();
    if (!r.ok) {
      audit("ERROR", `HTTP ${r.status}: ${txt.slice(0,200)}`);
      return {
        status: "DATA_UNAVAILABLE",
        error: `News API HTTP ${r.status}`,
        queryTerms: [query],
      };
    }
    const j = JSON.parse(txt);
    if (j?.status !== "ok") {
      audit("ERROR", j?.message || "Non-ok status");
      return {
        status: "DATA_UNAVAILABLE",
        error: `News API: ${j?.message ?? "unknown error"}`,
        queryTerms: [query],
      };
    }
    const items: NewsItem[] = (j.articles || []).slice(0, 12).map((a: any) => {
      const headline: string = (a.title || "").trim();
      const desc: string = (a.description || "").trim();
      const full = headline + (desc ? ` — ${desc}` : "");
      const low = full.toLowerCase();
      let sentiment: NewsItem["sentiment"] = "neutral";
      const bullTerms = ["rally", "surge", "gain", "bullish", "soar", "rise", "boost", "beat", "record high", "safe haven"];
      const bearTerms = ["fall", "drop", "plunge", "bearish", "decline", "tumble", "sell-off", "selloff", "crash", "slump", "fear", "hawkish"];
      const bullHits = bullTerms.filter((t) => low.includes(t)).length;
      const bearHits = bearTerms.filter((t) => low.includes(t)).length;
      if (bullHits > bearHits) sentiment = "bullish";
      else if (bearHits > bullHits) sentiment = "bearish";
      const highImpact = /fed|fomc|cpi|pce|nfp|rate decision|inflation|geopolitic|war|powel|powell|ecb|boj/i.test(full);
      return {
        headline: headline || "(untitled article)",
        source: a.source?.name ?? "Unknown",
        publishedAt: a.publishedAt ?? "",
        url: a.url,
        sentiment,
        potentialImpact: highImpact ? "high" : "medium",
      };
    });
    audit("OK");
    return { status: "OK", items, fetchedAt: new Date().toISOString(), queryTerms: [query] };
  } catch (e: any) {
    const err = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
    audit("ERROR", err);
    return { status: "DATA_UNAVAILABLE", error: `News API request failed: ${err}`, queryTerms: [query] };
  }
}

export async function validateNewsApi(): Promise<{
  ok: boolean;
  latency_ms: number;
  error?: string;
}> {
  const key = getEnv("NEWS_API_KEY");
  if (!key) return { ok: false, latency_ms: 0, error: "Missing API key" };
  const start = Date.now();
  try {
    const url =
      `https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${encodeURIComponent(key)}`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    const txt = await r.text();
    if (!r.ok) return { ok: false, latency_ms: Date.now() - start, error: `HTTP ${r.status}: ${txt.slice(0,200)}` };
    const j = JSON.parse(txt);
    if (j?.status !== "ok") return { ok: false, latency_ms: Date.now() - start, error: j?.message || "non-ok status" };
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: String(e?.message ?? e) };
  }
}
