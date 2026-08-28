"use client";
import { useState } from "react";

export default function DataFetch({ kind }: { kind: "market"|"news"|"macro" }) {
  const [cls, setCls] = useState<"GOLD"|"FOREX">("GOLD");
  const [symbol, setSymbol] = useState("XAU/USD");
  const [tf, setTf] = useState("4h");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function go() {
    setBusy(true); setErr(null); setData(null);
    try {
      let url = "";
      if (kind === "market") url = `/api/market?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`;
      else if (kind === "news") url = `/api/news?class=${cls}&symbol=${encodeURIComponent(symbol)}`;
      else url = `/api/macro?class=${cls}&symbol=${encodeURIComponent(symbol)}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "request failed");
      else setData(j);
    } catch (e:any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Asset class</label>
          <select className="input" value={cls} onChange={(e)=>{const v = e.target.value as any; setCls(v); setSymbol(v==="GOLD"?"XAU/USD":"EUR/USD");}}>
            <option value="GOLD">Gold</option><option value="FOREX">Forex</option>
          </select>
        </div>
        <div>
          <label className="label">Symbol</label>
          <input className="input" value={symbol} onChange={(e)=>setSymbol(e.target.value)} />
        </div>
        {kind === "market" && (
          <div>
            <label className="label">Timeframe</label>
            <select className="input" value={tf} onChange={(e)=>setTf(e.target.value)}>
              {["1m","5m","15m","30m","1h","4h","1d","1w"].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
          </div>
        )}
        <button className="btn btn-primary" disabled={busy} onClick={go}>{busy?"Fetching…":"Fetch"}</button>
      </div>

      {err && <div className="card border-red-900/60 bg-red-950/30 text-red-300">{err}</div>}

      {data && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <div className="section-title mb-0">Result — status: {data.status}</div>
            <div className="muted text-xs">{data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : ""}</div>
          </div>
          {data.error && <div className="text-red-300 text-sm mb-2">{data.error}</div>}
          {kind==="market" && data.candles && (
            <div>
              <div className="muted text-xs mb-2">{data.candles.length} candles (source: {data.source}). Showing last 20.</div>
              <pre className="text-[11px] overflow-auto max-h-96 bg-black/40 rounded p-2">
{JSON.stringify(data.candles.slice(-20), null, 2)}
              </pre>
            </div>
          )}
          {kind==="news" && data.items && (
            <ul className="space-y-2 text-sm">
              {data.items.map((n:any,i:number)=>(
                <li key={i} className="panel">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`chip ${n.sentiment==="bullish"?"chip-buy":n.sentiment==="bearish"?"chip-sell":"chip-muted"}`}>{n.sentiment}</span>
                    <span className="chip chip-muted">{n.potentialImpact}</span>
                    <span className="muted text-xs">{n.publishedAt ? new Date(n.publishedAt).toLocaleString() : ""} · {n.source}</span>
                  </div>
                  <div className="mt-1">{n.headline}</div>
                  {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="text-xs text-accent-info">{n.url}</a>}
                </li>
              ))}
            </ul>
          )}
          {kind==="macro" && data.series && (
            <div className="space-y-2">
              {data.series.map((s:any)=> (
                <div key={s.seriesId} className="panel text-sm">
                  <div className="font-semibold">{s.seriesId} — {s.title}</div>
                  <div className="muted text-xs">Latest: {s.latest?.value} @ {s.latest?.date} · {s.points.length} points</div>
                </div>
              ))}
            </div>
          )}
          {!data.candles && !data.items && !data.series && (
            <pre className="text-xs overflow-auto max-h-96 bg-black/40 p-2 rounded">{JSON.stringify(data, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
