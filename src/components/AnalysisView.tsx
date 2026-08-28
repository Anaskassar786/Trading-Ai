"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type AgentT = {
  agent_number: number;
  agent_name: string;
  model_used: string;
  provider_used: string;
  decision: "BUY"|"SELL"|"NO_TRADE";
  confidence: number;
  evidence: string[];
  supporting_factors: string[];
  contradicting_factors: string[];
  entry_zone: { low: number|null; high: number|null };
  stop_loss: number|null;
  take_profit_1: number|null;
  take_profit_2: number|null;
  take_profit_3: number|null;
  risk_reward: number|null;
  invalidation_conditions: string[];
  data_quality: "HIGH"|"MEDIUM"|"LOW"|"INSUFFICIENT";
  warnings: string[];
  error?: string;
};
type DebateT = {
  id: string; challenger_agent:number; challenged_agent:number; claim:string;
  counterclaim:string; evidence:string; assessment:string; winner_side:string;
  confidence_change?:number; model_used:string; provider_used:string;
};
type ContraT = { topic:string; confirmed_fact?:string;
  conflicting_claim_a:{agent:number;claim:string};
  conflicting_claim_b:{agent:number;claim:string};
  resolution?:string; status:string };
type DecisionT = {
  final_decision:"BUY"|"SELL"|"NO_TRADE";
  vote_distribution:{buy:number;sell:number;no_trade:number};
  final_confidence:number;
  entry:{low:number|null;high:number|null};
  stop_loss:number|null;
  targets:{tp1:number|null;tp2:number|null;tp3:number|null};
  risk_amount:number|null;
  position_size:number|null;
  risk_reward:number|null;
  decision_summary:string;
  strongest_bullish_arguments:string[];
  strongest_bearish_arguments:string[];
  rejected_arguments:string[];
  invalidation_conditions:string[];
  warnings:string[];
  data_quality:string;
  data_freshness?:string;
  model_used:string; provider_used:string;
};
type SnapshotT = {
  session_id: string; created_at: string;
  screenshot: any;
  instrument: {assetClass:string; symbol:string};
  user_timeframe: string; detected_timeframe?: string;
  timeframe_mismatch: boolean; timeframe_used: string;
  market: any; news: any; macro: any;
  risk: { riskAmount:number|null; accountBalance:number|null; desiredProfit:number|null };
  configured_models: any;
  test_mode: boolean;
};
type SessionData = {
  session_id: string; created_at: string; completed_at?: string;
  status: string; progress: number; progress_message: string;
  error?: string;
  snapshot: SnapshotT;
  agents: AgentT[]; debate: DebateT[]; contradictions: ContraT[];
  decision: DecisionT | null;
};

function chipFor(d: string) {
  if (d === "BUY") return "chip-buy";
  if (d === "SELL") return "chip-sell";
  if (d === "NO_TRADE") return "chip-wait";
  return "chip-muted";
}

const STEPS = [
  { pct: 3,  label: "Preparing screenshot..." },
  { pct: 6,  label: "Detecting timeframe..." },
  { pct: 10, label: "Fetching market data..." },
  { pct: 16, label: "Fetching news..." },
  { pct: 22, label: "Fetching macro data..." },
  { pct: 28, label: "Snapshot frozen." },
  { pct: 30, label: "Running Agent 1/10 — Technical Structure..." },
  { pct: 35, label: "Running Agent 2/10 — Smart Money Concept..." },
  { pct: 40, label: "Running Agent 3/10 — Liquidity..." },
  { pct: 45, label: "Running Agent 4/10 — Price Action..." },
  { pct: 50, label: "Running Agent 5/10 — Volume..." },
  { pct: 55, label: "Running Agent 6/10 — FVG & Supply/Demand..." },
  { pct: 60, label: "Running Agent 7/10 — Trend & Momentum..." },
  { pct: 65, label: "Running Agent 8/10 — Macro & Fundamental..." },
  { pct: 70, label: "Running Agent 9/10 — News & Sentiment..." },
  { pct: 75, label: "Running Agent 10/10 — Position Trading & Risk..." },
  { pct: 82, label: "Building adversarial debate..." },
  { pct: 90, label: "Chief Judge analyzing..." },
  { pct: 97, label: "Generating final report..." },
  { pct: 100, label: "Final report ready." },
];

function stepState(stepPct: number, curPct: number): "done"|"running"|"pending" {
  if (curPct >= stepPct) return "done";
  // Find the first undone step
  const prevPct = STEPS[Math.max(0, STEPS.findIndex(s => s.pct === stepPct) - 1)]?.pct ?? 0;
  if (curPct >= prevPct && curPct < stepPct) return "running";
  return "pending";
}

function RunningScreen({ data }: { data: SessionData }) {
  const done = data.status === "COMPLETED" || data.status === "FAILED";
  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="section-title mb-0">Analysis Running</h2>
        <span className={`chip ${data.status==="COMPLETED"?"chip-buy":data.status==="FAILED"?"chip-sell":"chip-muted"}`}>{data.status}</span>
      </div>
      <div className="w-full h-2 bg-bg-soft rounded overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300" style={{width: `${data.progress}%`}} />
      </div>
      <div className="text-sm text-slate-300">
        <span className="font-mono text-slate-400">{data.progress}%</span> — {data.progress_message}
      </div>
      <ol className="space-y-1.5 text-sm max-h-96 overflow-auto scrollbar-thin pr-2">
        {STEPS.map((s) => {
          const st = stepState(s.pct, data.progress);
          return (
            <li key={s.pct} className="flex items-center gap-2">
              <span className={
                st === "done" ? "w-5 h-5 rounded-full bg-emerald-600 grid place-items-center text-[10px] text-white" :
                st === "running" ? "w-5 h-5 rounded-full bg-blue-600 grid place-items-center text-[10px] text-white animate-pulse" :
                "w-5 h-5 rounded-full bg-bg-soft border border-bg-border grid place-items-center text-[10px] text-slate-500"
              }>
                {st === "done" ? "✓" : st === "running" ? "…" : "·"}
              </span>
              <span className={st === "pending" ? "text-slate-500" : "text-slate-200"}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      {data.status === "FAILED" && data.error && (
        <div className="border border-red-900/60 bg-red-950/30 text-red-300 rounded-lg p-3 text-sm">
          {data.error}
        </div>
      )}
      {done && (
        <div className="text-sm muted">Analysis finished. Scroll down to see the council, debate, and final verdict.</div>
      )}
    </div>
  );
}

function VoteBar({ v }: { v:{buy:number;sell:number;no_trade:number} }) {
  const total = v.buy + v.sell + v.no_trade || 1;
  const bp = (v.buy/total)*100, sp = (v.sell/total)*100, np = (v.no_trade/total)*100;
  return (
    <div>
      <div className="flex h-6 w-full rounded-lg overflow-hidden border border-bg-border text-xs">
        <div className="bg-emerald-600/70 grid place-items-center" style={{width: `${bp}%`}}>{v.buy>0?`BUY ${Math.round(bp)}%`:""}</div>
        <div className="bg-red-600/70 grid place-items-center" style={{width: `${sp}%`}}>{v.sell>0?`SELL ${Math.round(sp)}%`:""}</div>
        <div className="bg-amber-600/70 grid place-items-center text-black" style={{width: `${np}%`}}>{v.no_trade>0?`NO TRADE ${Math.round(np)}%`:""}</div>
      </div>
      <div className="muted text-xs mt-1">Agent vote distribution — NOT a probability of profit.</div>
    </div>
  );
}

function AgentCard({ a }: { a: AgentT }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-xs text-slate-400">Agent #{a.agent_number}</div>
          <div className="font-semibold">{a.agent_name}</div>
          <div className="text-[11px] text-slate-500 font-mono">{a.provider_used}/{a.model_used}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`chip ${chipFor(a.decision)}`}>{a.decision}</span>
          <span className="text-xs text-slate-400">conf {a.confidence}/100</span>
          <span className={`chip ${a.data_quality==="HIGH"?"chip-buy":a.data_quality==="MEDIUM"?"chip-muted":a.data_quality==="LOW"?"chip-wait":"chip-sell"}`}>DQ: {a.data_quality}</span>
        </div>
      </div>
      {a.error && <div className="text-xs text-red-400 mb-2">Error: {a.error}</div>}
      <div className="text-sm space-y-2">
        {a.evidence.length > 0 && (
          <div>
            <div className="label">Evidence</div>
            <ul className="list-disc pl-4 text-slate-300 space-y-0.5">
              {a.evidence.slice(0,8).map((e,i)=><li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {a.supporting_factors.length > 0 && <div><div className="label">Supporting</div><ul className="list-disc pl-4 text-slate-300">{a.supporting_factors.slice(0,5).map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
        {a.contradicting_factors.length > 0 && <div><div className="label">Contradicting</div><ul className="list-disc pl-4 text-slate-400">{a.contradicting_factors.slice(0,5).map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
        <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-bg-border">
          <div><span className="text-slate-500">Entry:</span> {a.entry_zone.low!=null||a.entry_zone.high!=null?`${a.entry_zone.low??"-"} – ${a.entry_zone.high??"-"}`:"—"}</div>
          <div><span className="text-slate-500">SL:</span> {a.stop_loss ?? "—"}</div>
          <div><span className="text-slate-500">TP1:</span> {a.take_profit_1 ?? "—"}</div>
          <div><span className="text-slate-500">TP2:</span> {a.take_profit_2 ?? "—"}</div>
          <div><span className="text-slate-500">TP3:</span> {a.take_profit_3 ?? "—"}</div>
          <div><span className="text-slate-500">R:R:</span> {a.risk_reward ?? "—"}</div>
        </div>
        {a.invalidation_conditions.length > 0 && <div><div className="label">Invalidation</div><ul className="list-disc pl-4 text-amber-200/80 text-xs">{a.invalidation_conditions.slice(0,5).map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
        {a.warnings.length > 0 && <div><div className="label">Warnings</div><ul className="list-disc pl-4 text-amber-300/90 text-xs">{a.warnings.slice(0,5).map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
      </div>
    </div>
  );
}

function FinalVerdict({ d, onFeedback, feedbackMsg }: { d: DecisionT; onFeedback: (r:"WIN"|"LOSS"|"BREAKEVEN"|"SKIPPED")=>void; feedbackMsg: string|null }) {
  const color = d.final_decision==="BUY"?"text-emerald-400":d.final_decision==="SELL"?"text-red-400":"text-amber-400";
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="section-title mb-0">Chief Judge Verdict — Trade Plan</h2>
        <span className={`chip ${chipFor(d.final_decision)} text-base px-4 py-1`}>{d.final_decision}</span>
      </div>
      <VoteBar v={d.vote_distribution} />
      <div className="grid md:grid-cols-3 gap-3 mt-4">
        <div className="panel"><div className="label">Chief Judge confidence</div><div className={`text-3xl font-bold ${color}`}>{d.final_confidence}/100</div><div className="muted text-[11px]">Epistemic confidence in this decision, NOT win probability.</div></div>
        <div className="panel"><div className="label">Entry zone</div><div className="text-xl font-mono">{d.entry.low!=null||d.entry.high!=null?`${d.entry.low??"—"} – ${d.entry.high??"—"}`:"—"}</div></div>
        <div className="panel"><div className="label">Stop loss</div><div className="text-xl font-mono text-red-300">{d.stop_loss ?? "—"}</div></div>
        <div className="panel"><div className="label">Targets TP1 / TP2 / TP3</div><div className="text-lg font-mono">{d.targets.tp1??"—"} / {d.targets.tp2??"—"} / {d.targets.tp3??"—"}</div></div>
        <div className="panel"><div className="label">Risk amount</div><div className="text-xl font-mono">{d.risk_amount != null ? `₹${d.risk_amount}` : "—"}</div></div>
        <div className="panel"><div className="label">Position size</div><div className="text-xl font-mono">{d.position_size != null ? d.position_size.toFixed(4) : "—"}</div><div className="muted text-[11px]">Risk-per-unit estimate. Lot/pip sizing requires broker instrument specs.</div></div>
        <div className="panel"><div className="label">R:R (to TP1)</div><div className="text-xl font-mono">{d.risk_reward != null ? `1:${d.risk_reward.toFixed(2)}` : "—"}</div></div>
        <div className="panel"><div className="label">Data quality</div><div className="text-xl font-semibold">{d.data_quality}</div><div className="muted text-[11px]">Freshness: {d.data_freshness ? new Date(d.data_freshness).toLocaleString() : "n/a"}</div></div>
        <div className="panel"><div className="label">Model</div><div className="text-sm font-mono">{d.provider_used}/{d.model_used}</div></div>
      </div>
      <div className="mt-4 space-y-3 text-sm">
        <div>
          <div className="label">Why this decision?</div>
          <p className="text-slate-200 whitespace-pre-wrap">{d.decision_summary || "(no summary)"}</p>
        </div>
        {d.strongest_bullish_arguments.length>0 && <div><div className="label">Strongest bullish arguments</div><ul className="list-disc pl-5 text-emerald-200/90">{d.strongest_bullish_arguments.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
        {d.strongest_bearish_arguments.length>0 && <div><div className="label">Strongest bearish arguments</div><ul className="list-disc pl-5 text-red-200/90">{d.strongest_bearish_arguments.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
        {d.rejected_arguments.length>0 && <div><div className="label">Rejected arguments</div><ul className="list-disc pl-5 text-slate-400">{d.rejected_arguments.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
        <div>
          <div className="label">What invalidates this?</div>
          {d.invalidation_conditions.length>0
            ? <ul className="list-disc pl-5 text-amber-200/90">{d.invalidation_conditions.map((x,i)=><li key={i}>{x}</li>)}</ul>
            : <p className="muted">No invalidation conditions provided by the judge — treat this as INSUFFICIENT plan clarity.</p>}
        </div>
        <div>
          <div className="label">Important warnings</div>
          {d.warnings.length>0
            ? <ul className="list-disc pl-5 text-amber-300">{d.warnings.map((x,i)=><li key={i}>{x}</li>)}</ul>
            : <p className="muted">No warnings.</p>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 items-center">
        <div className="muted text-xs mr-2">Record outcome (does not change original prediction):</div>
        <button className="btn btn-buy" onClick={()=>onFeedback("WIN")}>WIN</button>
        <button className="btn btn-sell" onClick={()=>onFeedback("LOSS")}>LOSS</button>
        <button className="btn" onClick={()=>onFeedback("BREAKEVEN")}>BREAKEVEN</button>
        <button className="btn" onClick={()=>onFeedback("SKIPPED")}>SKIPPED</button>
        {feedbackMsg && <span className="muted text-xs ml-2">{feedbackMsg}</span>}
      </div>
    </div>
  );
}

function SectionHeader({ n, title, subtitle }: { n:number; title:string; subtitle?:string }) {
  return (
    <div className="flex items-baseline gap-3 mt-8 mb-2">
      <span className="text-xs font-mono text-slate-500">ROUND {n}</span>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {subtitle && <span className="muted text-xs">{subtitle}</span>}
    </div>
  );
}

export default function AnalysisView({ sessionId, initial }: { sessionId: string; initial: SessionData }) {
  const [data, setData] = useState<SessionData>(initial);
  const [fbMsg, setFbMsg] = useState<string|null>(null);
  const done = data.status === "COMPLETED" || data.status === "FAILED";
  const hasAgents = data.agents.length > 0;
  const snap = data.snapshot;

  useEffect(() => {
    if (done) return;
    // Auto-kick the agent pipeline if session was just created (CREATED) and not yet running.
    if (data.status === "CREATED") {
      fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(()=>{});
    }
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setData(j);
          if (j.status === "COMPLETED" || j.status === "FAILED") clearInterval(t);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(t);
  }, [done, sessionId, data.status]);

  async function sendFeedback(r: "WIN"|"LOSS"|"BREAKEVEN"|"SKIPPED") {
    setFbMsg(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, result: r }),
    });
    const j = await res.json();
    setFbMsg(res.ok ? `Recorded: ${r}` : (j.error || "Failed"));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analysis Session</h1>
          <div className="muted font-mono text-xs">{data.session_id}</div>
          <div className="muted text-xs">
            Created {new Date(data.created_at).toLocaleString()}
            {data.completed_at ? ` · completed ${new Date(data.completed_at).toLocaleString()}` : ""}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <span className={`chip ${data.status==="COMPLETED"?"chip-buy":data.status==="FAILED"?"chip-sell":"chip-muted"}`}>{data.status}</span>
          <Link href="/new-analysis" className="btn btn-primary">New Analysis</Link>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card space-y-2">
          <div className="section-title">Frozen snapshot</div>
          <div className="text-sm space-y-1">
            <div><span className="muted">Instrument:</span> {snap.instrument.assetClass} / {snap.instrument.symbol}</div>
            <div><span className="muted">User TF:</span> {snap.user_timeframe.toUpperCase()}</div>
            <div>
              <span className="muted">Detected TF:</span>{" "}
              {snap.detected_timeframe
                ? <span>{snap.detected_timeframe.toUpperCase()}{snap.timeframe_mismatch ? <span className="text-amber-300"> · MISMATCH — using {snap.timeframe_used.toUpperCase()}</span> : null}</span>
                : <span className="text-slate-500">UNKNOWN</span>}
            </div>
            <div><span className="muted">Risk amount:</span> {snap.risk.riskAmount ?? "—"} | Balance: {snap.risk.accountBalance ?? "—"} | Target: {snap.risk.desiredProfit ?? "—"}</div>
            <div><span className="muted">Market:</span> {snap.market.status === "OK" ? <span className="text-emerald-300">OK ({snap.market.candles?.length ?? 0} candles)</span> : <span className="text-red-300">DATA_UNAVAILABLE — {snap.market.error ?? ""}</span>}</div>
            <div><span className="muted">News:</span> {snap.news.status === "OK" ? <span className="text-emerald-300">OK ({snap.news.items?.length ?? 0})</span> : <span className="text-red-300">DATA_UNAVAILABLE — {snap.news.error ?? ""}</span>}</div>
            <div><span className="muted">Macro:</span> {snap.macro.status === "OK" ? <span className="text-emerald-300">OK ({snap.macro.series?.length ?? 0} series)</span> : <span className="text-red-300">DATA_UNAVAILABLE — {snap.macro.error ?? ""}</span>}</div>
            {snap.test_mode && <div className="text-amber-300 font-semibold">TEST DATA MODE ACTIVE — DO NOT TRADE</div>}
          </div>
        </div>
        <div className="card">
          <div className="section-title">Screenshot</div>
          {snap.screenshot ? (
            <>
              <img src={`/api/sessions/${data.session_id}/screenshot`} alt="chart" className="w-full h-auto rounded-lg border border-bg-border" />
              {snap.screenshot.visionDescription && <p className="muted text-xs mt-2"><span className="muted">Vision description:</span> {snap.screenshot.visionDescription}</p>}
            </>
          ) : <div className="muted">No screenshot uploaded.</div>}
        </div>
      </div>

      {!done && <RunningScreen data={data} />}
      {data.error && done && data.status === "FAILED" && <div className="card border-red-900/60 bg-red-950/30 text-red-300">Error: {data.error}</div>}

      {hasAgents && (
        <>
          <SectionHeader n={1} title="Agent Council" subtitle={`${data.agents.length}/10 independent Round-1 analyses`} />
          {(() => {
            const errors = data.agents.map((a) => a.error).filter(Boolean) as string[];
            const uniqueErrors = Array.from(new Set(errors));
            const allSame = errors.length === data.agents.length && uniqueErrors.length === 1;
            if (allSame) {
              return (
                <div className="border border-red-800/60 bg-red-950/30 text-red-200 rounded-xl p-3 text-sm mb-3">
                  <strong>All 10 agents failed with the same error:</strong>{" "}
                  <span className="font-mono text-xs">{uniqueErrors[0]}</span>
                  <div className="muted mt-1">
                    This usually means no LLM provider is reachable (no internet access / invalid key / provider down).
                    No agents, debate, or verdict could be produced with real model output, so the verdict defaults to{" "}
                    <span className="chip chip-wait ml-1">NO TRADE</span>. Nothing was fabricated.
                  </div>
                </div>
              );
            }
            if (errors.length > 0) {
              return (
                <div className="muted text-xs mb-3">
                  {errors.length}/{data.agents.length} agents reported errors (shown on their cards). The other agents returned real structured output.
                </div>
              );
            }
            return null;
          })()}
          <div className="grid md:grid-cols-2 gap-3">
            {data.agents.map(a => <AgentCard key={a.agent_number} a={a} />)}
          </div>
        </>
      )}

      {data.debate.length > 0 && (
        <>
          <SectionHeader n={2} title="Debate Room" subtitle="Adversarial challenges referencing concrete claims" />
          <div className="space-y-3">
            {data.debate.map((t,i)=>(
              <div key={t.id} className="card border border-bg-border">
                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                  <div className="font-semibold">Turn {i+1}: Agent #{t.challenger_agent} challenges Agent #{t.challenged_agent}</div>
                  <span className={`chip ${chipFor(t.winner_side)}`}>{t.winner_side}</span>
                </div>
                <div className="mt-2 text-sm space-y-1.5">
                  <div><span className="muted">Claim (A{t.challenged_agent}):</span> &ldquo;{t.claim}&rdquo;</div>
                  <div><span className="muted">Counter (A{t.challenger_agent}):</span> {t.counterclaim}</div>
                  <div><span className="muted">Evidence:</span> {t.evidence}</div>
                  <div><span className="muted">Assessment:</span> {t.assessment}</div>
                  {typeof t.confidence_change === 'number' && t.confidence_change !== 0 && <div className="muted text-xs">Suggested confidence adjustment: {t.confidence_change>0?"+":""}{t.confidence_change}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {data.contradictions.length > 0 && (
        <>
          <SectionHeader n={2} title="Contradiction Engine" subtitle="Unresolved conflicts are surfaced, not forced" />
          <div className="card">
            <ul className="space-y-2 text-sm">
              {data.contradictions.map((c,i)=>(
                <li key={i} className="panel">
                  <div className="font-semibold mb-1">{c.topic} <span className="chip chip-muted ml-1">{c.status}</span></div>
                  <div className="muted">A{c.conflicting_claim_a.agent}: {c.conflicting_claim_a.claim}</div>
                  <div className="muted">A{c.conflicting_claim_b.agent}: {c.conflicting_claim_b.claim}</div>
                  {c.resolution && <div className="mt-1 text-emerald-200/90">Resolution: {c.resolution}</div>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {data.decision && (
        <>
          <SectionHeader n={3} title="Chief Judge" subtitle="Independent final verdict" />
          <FinalVerdict d={data.decision} onFeedback={sendFeedback} feedbackMsg={fbMsg} />
        </>
      )}
    </div>
  );
}
