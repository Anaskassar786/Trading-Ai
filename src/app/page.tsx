import Link from "next/link";

async function getSummary() {
  // Server-side fetch of summary data
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
  try {
    const [sRes, hRes] = await Promise.all([
      fetch(`${base}/api/sessions`, { cache: "no-store" }),
      fetch(`${base}/api/health?refresh=0`, { cache: "no-store" }),
    ]);
    const s = sRes.ok ? await sRes.json() : { sessions: [] };
    const h = hRes.ok ? await hRes.json() : { providers: [] };
    return { sessions: s.sessions || [], providers: h.providers || [] };
  } catch {
    return { sessions: [], providers: [] };
  }
}

function DecisionChip({ d }: { d: string | null }) {
  if (!d) return <span className="chip chip-muted">PENDING</span>;
  if (d === "BUY") return <span className="chip chip-buy">BUY</span>;
  if (d === "SELL") return <span className="chip chip-sell">SELL</span>;
  return <span className="chip chip-wait">NO TRADE</span>;
}

export default async function Dashboard() {
  const { sessions, providers } = await getSummary();
  const total = sessions.length;
  const buys = sessions.filter((s: any) => s.final_decision === "BUY").length;
  const sells = sessions.filter((s: any) => s.final_decision === "SELL").length;
  const notrades = sessions.filter((s: any) => s.final_decision === "NO_TRADE").length;
  const configuredCount = providers.filter((p: any) => p.configured).length;
  const healthyCount = providers.filter((p: any) => p.configured && p.reachable && p.auth_valid).length;

  return (
    <div className="space-y-6">
      <section className="panel">
        <h1 className="text-2xl font-bold mb-1">Trading AI AK</h1>
        <p className="muted mb-4">
          10 specialist AI agents + 1 Chief Judge. Multi-agent adversarial analysis for position trading in Gold &amp; Forex.
          This tool does <strong>not</strong> place live trades and does <strong>not</strong> fabricate data.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/new-analysis" className="btn btn-primary">Start New Analysis →</Link>
          <Link href="/api-health" className="btn">API Health</Link>
          <Link href="/history" className="btn">Trade History</Link>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card"><div className="muted">Total Analyses</div><div className="text-2xl font-bold">{total}</div></div>
        <div className="card"><div className="muted">BUY calls</div><div className="text-2xl font-bold text-emerald-400">{buys}</div></div>
        <div className="card"><div className="muted">SELL calls</div><div className="text-2xl font-bold text-red-400">{sells}</div></div>
        <div className="card"><div className="muted">NO TRADE calls</div><div className="text-2xl font-bold text-amber-400">{notrades}</div></div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="section-title">Recent Analyses</h2>
          {sessions.length === 0 ? (
            <p className="muted">No analyses yet. Start one from <Link href="/new-analysis">New Analysis</Link>.</p>
          ) : (
            <ul className="divide-y divide-bg-border">
              {sessions.slice(0, 8).map((s: any) => (
                <li key={s.session_id} className="py-2 flex items-center justify-between gap-2">
                  <div>
                    <Link href={`/analysis/${s.session_id}`} className="text-sm font-mono text-accent-info hover:underline">
                      {s.session_id.slice(0, 18)}…
                    </Link>
                    <div className="muted text-xs">{new Date(s.created_at).toLocaleString()} · {s.progress_message}</div>
                  </div>
                  <DecisionChip d={s.final_decision} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="section-title">API Status (cached) <Link href="/api-health" className="text-xs text-accent-info ml-2">details →</Link></h2>
          {providers.length === 0 ? (
            <p className="muted">No health data yet. Visit the <Link href="/api-health">API Health</Link> page.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {providers.map((p: any) => (
                <li key={p.provider} className="flex items-center justify-between">
                  <span className="font-medium">{p.provider}</span>
                  <span className="flex items-center gap-2">
                    {!p.configured ? <span className="chip chip-muted">NOT CONFIGURED</span> :
                      p.reachable && p.auth_valid ? <span className="chip chip-buy">OK {p.latency_ms ? `(${p.latency_ms}ms)` : ""}</span> :
                      <span className="chip chip-sell">FAIL</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted text-xs mt-3">
            Configured: {configuredCount}/7 · Healthy: {healthyCount}/7. API keys are server-only and never exposed to the browser.
          </p>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Operating rules</h2>
        <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
          <li>10 independent Round-1 agents. They never see each other&apos;s conclusions before voting.</li>
          <li>Structured adversarial debate (Round 2). Challenges must reference concrete claims.</li>
          <li>Independent Chief Judge (Round 3) weighs evidence, contradictions, risk and data quality.</li>
          <li>Every analysis session is immutable. Re-running creates a new session; original results are preserved.</li>
          <li>Missing data returns <code className="kbd">DATA_UNAVAILABLE</code> — never invented.</li>
          <li>NO_TRADE is a first-class and common outcome.</li>
        </ul>
      </section>
    </div>
  );
}
