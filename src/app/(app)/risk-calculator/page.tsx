"use client";
import { useState } from "react";

export default function RiskCalc() {
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp1, setTp1] = useState("");
  const [riskAmt, setRiskAmt] = useState("");
  const [balance, setBalance] = useState("");

  const e = parseFloat(entry), s = parseFloat(sl), t = parseFloat(tp1);
  const r = parseFloat(riskAmt), b = parseFloat(balance);
  const valid = isFinite(e) && isFinite(s) && e !== s;
  const riskPerUnit = valid ? Math.abs(e - s) : 0;
  const rewardPerUnit = valid && isFinite(t) ? Math.abs(t - e) : 0;
  const rr = valid && isFinite(t) && riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : null;
  const size = riskPerUnit > 0 && isFinite(r) ? r / riskPerUnit : null;
  const pct = isFinite(b) && b > 0 && isFinite(r) ? (r / b) * 100 : null;

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold">Risk Calculator</h1>
      <p className="muted">
        Simple position-trade risk helper. This is a generic risk-per-unit calculator; proper lot/pip sizing for gold/forex
        requires instrument specifications (lot size, contract size, pip value) which are broker-specific and not assumed.
      </p>
      <div className="card grid grid-cols-2 gap-3">
        <div><label className="label">Entry</label><input className="input" type="number" step="any" value={entry} onChange={e=>setEntry(e.target.value)} /></div>
        <div><label className="label">Stop loss</label><input className="input" type="number" step="any" value={sl} onChange={e=>setSl(e.target.value)} /></div>
        <div><label className="label">TP1</label><input className="input" type="number" step="any" value={tp1} onChange={e=>setTp1(e.target.value)} /></div>
        <div><label className="label">Risk amount</label><input className="input" type="number" step="any" value={riskAmt} onChange={e=>setRiskAmt(e.target.value)} /></div>
        <div><label className="label">Account balance (optional)</label><input className="input" type="number" step="any" value={balance} onChange={e=>setBalance(e.target.value)} /></div>
      </div>
      <div className="card grid grid-cols-2 gap-3 text-sm">
        <div><div className="label">Risk per unit</div><div className="font-mono text-lg">{riskPerUnit ? riskPerUnit.toFixed(4) : "—"}</div></div>
        <div><div className="label">Reward per unit</div><div className="font-mono text-lg">{rewardPerUnit ? rewardPerUnit.toFixed(4) : "—"}</div></div>
        <div><div className="label">R:R (to TP1)</div><div className="font-mono text-lg">{rr != null ? `1:${rr.toFixed(2)}` : "—"}</div></div>
        <div><div className="label">Size (risk/risk-per-unit)</div><div className="font-mono text-lg">{size != null ? size.toFixed(4) : "—"}</div></div>
        <div><div className="label">Risk % of balance</div><div className={`font-mono text-lg ${pct != null && pct > 3 ? "text-amber-300" : ""}`}>{pct != null ? `${pct.toFixed(2)}%` : "—"}</div></div>
        <div><div className="label">Warning</div>
          <div className="text-xs text-amber-200">
            {pct != null && pct > 5 ? "Risk exceeds 5% — very high risk." : rr != null && rr < 1 ? "R:R below 1:1." : "Structural SL/TP and macro context should come from a full analysis."}
          </div>
        </div>
      </div>
    </div>
  );
}
