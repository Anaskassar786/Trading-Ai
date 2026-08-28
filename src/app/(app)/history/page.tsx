import Link from "next/link";
import { listSessions, listOutcomes } from "@/lib/db";

export const metadata = { title: "Trade History — Trading AI AK" };

export default function History() {
  const sessions = listSessions();
  const outcomesBySession = new Map<string, any[]>();
  for (const o of listOutcomes()) {
    const arr = outcomesBySession.get(o.session_id) ?? [];
    arr.push(o);
    outcomesBySession.set(o.session_id, arr);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Trade History</h1>
      <p className="muted">Immutable log of all analysis sessions and recorded outcomes. Original predictions are never overwritten.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-bg-border">
              <th className="py-2 pr-3">Session</th>
              <th className="py-2 pr-3">Created</th>
              <th className="py-2 pr-3">Decision</th>
              <th className="py-2 pr-3">Confidence</th>
              <th className="py-2 pr-3">Outcome</th>
              <th className="py-2 pr-3">P/L</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center muted">No analyses yet.</td></tr>
            )}
            {sessions.map((s) => {
              const decision = s.decision_json ? JSON.parse(s.decision_json) : null;
              const outs = outcomesBySession.get(s.session_id) ?? [];
              const last = outs[outs.length-1];
              return (
                <tr key={s.session_id} className="border-b border-bg-border/60">
                  <td className="py-2 pr-3 font-mono text-xs">{s.session_id.slice(0,18)}…</td>
                  <td className="py-2 pr-3 text-xs">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">
                    {decision ? (
                      <span className={`chip ${decision.final_decision==="BUY"?"chip-buy":decision.final_decision==="SELL"?"chip-sell":"chip-wait"}`}>{decision.final_decision}</span>
                    ) : <span className="chip chip-muted">{s.status}</span>}
                  </td>
                  <td className="py-2 pr-3">{decision?.final_confidence ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {last ? <span className={`chip ${last.result==="WIN"?"chip-buy":last.result==="LOSS"?"chip-sell":"chip-muted"}`}>{last.result}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="py-2 pr-3 font-mono">{last?.actual_pl != null ? last.actual_pl : "—"}</td>
                  <td className="py-2 pr-3"><Link href={`/analysis/${s.session_id}`} className="text-accent-info">view →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
