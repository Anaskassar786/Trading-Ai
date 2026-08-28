"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const SYMBOLS_GOLD = ["XAU/USD"];
const SYMBOLS_FOREX = [
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD",
];
const TIMEFRAMES = ["1m","5m","15m","30m","1h","4h","1d","1w"] as const;

export default function NewAnalysisForm() {
  const router = useRouter();
  const [assetClass, setAssetClass] = useState<"GOLD"|"FOREX">("GOLD");
  const [symbol, setSymbol] = useState("XAU/USD");
  const [tf, setTf] = useState<typeof TIMEFRAMES[number]>("4h");
  const [riskAmount, setRiskAmount] = useState<string>("");
  const [balance, setBalance] = useState<string>("");
  const [desiredProfit, setDesiredProfit] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<{
    visionWarning?: string;
    detectedTf?: string | null;
    detectedSymbol?: string | null;
    mismatch?: boolean;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreflight(null);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPreflight(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("instrumentClass", assetClass);
      fd.append("symbol", symbol);
      fd.append("userTimeframe", tf);
      if (riskAmount) fd.append("riskAmount", riskAmount);
      if (balance) fd.append("accountBalance", balance);
      if (desiredProfit) fd.append("desiredProfit", desiredProfit);
      if (file) fd.append("screenshot", file);

      // 1) Create session (validates input, ingests screenshot, freezes snapshot)
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create analysis session");
        setBusy(false);
        return;
      }

      setPreflight({
        visionWarning: data.vision_warning,
        detectedTf: data.detected_timeframe,
        detectedSymbol: data.detected_symbol,
        mismatch: data.timeframe_mismatch,
      });

      // 2) Kick off the agent pipeline (returns immediately)
      await fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: data.session_id }),
      });

      // 3) Navigate to the running/result page which polls for progress
      router.push(`/analysis/${data.session_id}`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setBusy(false);
    }
  }

  const mismatch = preflight?.mismatch;

  return (
    <form onSubmit={submit} className="grid md:grid-cols-2 gap-5">
      <div className="card space-y-4">
        <h2 className="section-title">Inputs</h2>

        <div>
          <label className="label">Instrument class</label>
          <div className="flex gap-2">
            <button type="button" className={`btn flex-1 ${assetClass==="GOLD"?"btn-primary":""}`} onClick={()=>{setAssetClass("GOLD");setSymbol("XAU/USD");}}>Gold</button>
            <button type="button" className={`btn flex-1 ${assetClass==="FOREX"?"btn-primary":""}`} onClick={()=>{setAssetClass("FOREX");setSymbol("EUR/USD");}}>Forex</button>
          </div>
        </div>

        <div>
          <label className="label">Symbol</label>
          <select className="input" value={symbol} onChange={(e)=>setSymbol(e.target.value)}>
            {(assetClass === "GOLD" ? SYMBOLS_GOLD : SYMBOLS_FOREX).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div>
          <label className="label">User-selected timeframe</label>
          <div className="flex flex-wrap gap-1">
            {TIMEFRAMES.map(t => (
              <button type="button" key={t} onClick={()=>setTf(t)} className={`btn text-xs px-2.5 py-1 ${tf===t?"btn-primary":""}`}>{t.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Risk Amount *</label>
            <input className="input" type="number" inputMode="decimal" step="any" min="0" value={riskAmount} onChange={(e)=>setRiskAmount(e.target.value)} placeholder="e.g. 500" required />
          </div>
          <div>
            <label className="label">Account Balance (optional)</label>
            <input className="input" type="number" inputMode="decimal" step="any" min="0" value={balance} onChange={(e)=>setBalance(e.target.value)} placeholder="e.g. 10000" />
          </div>
          <div>
            <label className="label">Desired Profit (optional)</label>
            <input className="input" type="number" inputMode="decimal" step="any" min="0" value={desiredProfit} onChange={(e)=>setDesiredProfit(e.target.value)} placeholder="e.g. 2000" />
          </div>
        </div>

        <div>
          <label className="label">Chart screenshot</label>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className="hidden" />
          <button type="button" className="btn w-full" onClick={()=>fileRef.current?.click()}>
            {file ? `Change file: ${file.name}` : "Upload chart screenshot (PNG/JPG/WEBP)"}
          </button>
          <p className="muted text-xs mt-1">Max 8 MB. Vision detection runs server-side using the configured multimodal model. Chart text is treated as untrusted data.</p>
        </div>

        {mismatch && (
          <div className="border border-amber-700/60 bg-amber-950/30 text-amber-200 rounded-lg p-3 text-sm">
            <div className="font-semibold mb-1">Timeframe mismatch detected</div>
            <div>Detected timeframe: <strong>{(preflight?.detectedTf ?? "?").toUpperCase()}</strong></div>
            <div>User-selected timeframe: <strong>{tf.toUpperCase()}</strong></div>
            <div className="mt-1">The analysis will use the <strong>detected</strong> timeframe. You can cancel and re-upload if this is incorrect.</div>
          </div>
        )}

        {error && <div className="text-red-400 text-sm border border-red-900/60 bg-red-950/30 rounded-lg p-2">{error}</div>}
        {preflight?.visionWarning && !mismatch && (
          <div className="text-amber-300 text-sm border border-amber-900/60 bg-amber-950/30 rounded-lg p-2">{preflight.visionWarning}</div>
        )}

        <button type="submit" className="btn btn-primary w-full py-3 text-base" disabled={busy}>
          {busy ? "Starting analysis…" : "Analyze"}
        </button>
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">Preview &amp; preflight</h2>
        {previewUrl ? (
          <div className="rounded-lg overflow-hidden border border-bg-border bg-black">
            <img src={previewUrl} alt="screenshot preview" className="w-full h-auto" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-bg-border p-10 text-center muted">
            No screenshot uploaded. You may run analysis without a screenshot, but chart-vision agents will mark <code>data_quality INSUFFICIENT</code> and the council will likely return NO_TRADE unless live market data is sufficient.
          </div>
        )}
        <div className="text-xs text-slate-400 space-y-1">
          <div><span className="text-slate-500">Selected instrument:</span> {assetClass} / {symbol}</div>
          <div><span className="text-slate-500">Selected timeframe:</span> {tf.toUpperCase()}</div>
          <div>
            <span className="text-slate-500">Detected:</span>{" "}
            {preflight
              ? `${preflight.detectedSymbol ?? "symbol unknown"} / ${(preflight.detectedTf ?? "tf unknown").toString().toUpperCase()}${preflight.mismatch ? " (MISMATCH)" : ""}`
              : "(after upload, vision-based detection will appear here)"}
          </div>
        </div>
      </div>
    </form>
  );
}
