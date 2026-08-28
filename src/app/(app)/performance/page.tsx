import Link from "next/link";
import { listSessions, listOutcomes } from "@/lib/db";

export const metadata = { title: "AI Performance — Trading AI AK" };

export default function Performance() {
  const sessions = listSessions().filter((s) => s.decision_json);
  const outcomes = listOutcomes();
  const closed = outcomes.filter((o) => ["WIN","LOSS","BREAKEVEN"].includes(o.result));
  const wins = closed.filter((o) => o.result === "WIN").length;
  const losses = closed.filter((o) => o.result === "LOSS").length;
  const be = closed.filter((o) => o.result === "BREAKEVEN").length;
  const skipped = outcomes.filter((o) => o.result === "SKIPPED").length;

  // Per-agent statistics
  type AgentStat = { total:number; buy:number; sell:number; wait:number; agreedWithJudge:number; errors:number; };
  const agentStats: Record<number, AgentStat> = {};
  for (const s of sessions) {
    const agents = s.agents_json ? JSON.parse(s.agents_json) : [];
    const dec = s.decision_json ? JSON.parse(s.decision_json).final_decision : null;
    for (const a of agents) {
      const st = agentStats[a.agent_number] ?? { total:0,buy:0,sell:0,wait:0,agreedWithJudge:0,errors:0 };
      st.total++;
      if (a.decision === "BUY") st.buy++;
      else if (a.decision === "SELL") st.sell++;
      else st.wait++;
      if (a.error) st.errors++;
      if (dec && a.decision === dec) st.agreedWithJudge++;
      agentStats[a.agent_number] = st;
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">AI Performance</h1>
      <p className="muted">
        Metrics are computed from closed (user-validated) outcomes. Denominators are always shown.
        These are <strong>not</strong> backtest results — they track the council&apos;s real recommendations and your labelled outcomes.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card"><div className="muted">Total analyses w/ verdict</div><div className="text-2xl font-bold">{sessions.length}</div></div>
        <div className="card"><div className="muted">Closed outcomes</div><div className="text-2xl font-bold">{closed.length}</div></div>
        <div className="card"><div className="muted">Wins</div><div className="text-2xl font-bold text-emerald-400">{wins}</div></div>
        <div className="card"><div className="muted">Losses</div><div className="text-2xl font-bold text-red-400">{losses}</div></div>
        <div className="card"><div className="muted">Breakeven / Skipped</div><div className="text-2xl font-bold">{be} / {skipped}</div></div>
      </div>

      <div className="card">
        <h2 className="section-title">Directional accuracy (closed outcomes only)</h2>
        {closed.length === 0 ? (
          <p className="muted">No closed outcomes yet. Mark results from the analysis page to populate metrics.</p>
        ) : (
          <div className="text-sm">
            <div>Win rate on closed trades: <strong>{Math.round((wins/closed.length)*100)}%</strong> ({wins}/{closed.length})</div>
            <div className="muted text-xs">Note: this is an observational tally of trades you took, not a statistically validated backtest.</div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Agent performance (all sessions)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-bg-border">
                <th className="py-2 pr-3">#</th><th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Analyses</th>
                <th className="py-2 pr-3">BUY</th><th className="py-2 pr-3">SELL</th><th className="py-2 pr-3">NO TRADE</th>
                <th className="py-2 pr-3">Agreed w/ Judge</th><th className="py-2 pr-3">Errors</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({length:10}, (_,i)=>i+1).map(n => {
                const st = agentStats[n];
                if (!st) return (
                  <tr key={n} className="border-b border-bg-border/60">
                    <td className="py-2">{n}</td><td className="py-2">—</td><td className="muted">0</td><td colSpan={5}></td>
                  </tr>
                );
                return (
                  <tr key={n} className="border-b border-bg-border/60">
                    <td className="py-2 pr-3">{n}</td>
                    <td className="py-2 pr-3">{
                      [,"Technical Structure","Smart Money Concept","Liquidity","Price Action","Volume","FVG & Supply/Demand","Trend & Momentum","Macro & Fundamental","News & Sentiment","Position Trading & Risk"][n]
                    }</td>
                    <td className="py-2 pr-3">{st.total}</td>
                    <td className="py-2 pr-3 text-emerald-300">{st.buy}</td>
                    <td className="py-2 pr-3 text-red-300">{st.sell}</td>
                    <td className="py-2 pr-3 text-amber-300">{st.wait}</td>
                    <td className="py-2 pr-3">{st.agreedWithJudge}/{st.total}{st.total>0?` (${Math.round((st.agreedWithJudge/st.total)*100)}%)`:""}</td>
                    <td className="py-2 pr-3 text-red-300">{st.errors}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
