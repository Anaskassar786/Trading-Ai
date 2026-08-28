"use client";
import { useEffect, useState } from "react";

type Prov = {
  provider: string;
  configured: boolean;
  reachable: boolean;
  auth_valid: boolean;
  endpoint_valid: boolean;
  model_valid?: boolean;
  last_success_at?: string;
  last_error?: string;
  latency_ms?: number;
  note?: string;
};

export default function ApiHealth() {
  const [providers, setProviders] = useState<Prov[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function refresh() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/health?refresh=1&_=${Date.now()}`, { cache: "no-store" });
      const j = await r.json();
      setProviders(j.providers || []);
    } catch (e:any) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">API Health</h1>
        <button className="btn btn-primary" onClick={refresh} disabled={loading}>{loading?"Testing…":"Run health checks"}</button>
      </div>
      <p className="muted">Each provider is tested for configuration, reachability, authentication, and endpoint/model validity. Keys are never displayed.</p>
      {err && <div className="card text-red-300">{err}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-bg-border">
              <th className="py-2 pr-3">Provider</th>
              <th className="py-2 pr-3">Configured</th>
              <th className="py-2 pr-3">Reachable</th>
              <th className="py-2 pr-3">Auth valid</th>
              <th className="py-2 pr-3">Endpoint valid</th>
              <th className="py-2 pr-3">Model/endpoint</th>
              <th className="py-2 pr-3">Latency</th>
              <th className="py-2 pr-3">Last success</th>
              <th className="py-2 pr-3">Last error</th>
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center muted">{loading?"Running…":"No results yet."}</td></tr>
            )}
            {providers.map(p => (
              <tr key={p.provider} className="border-b border-bg-border/60 align-top">
                <td className="py-2 pr-3 font-semibold">{p.provider}</td>
                <td className="py-2 pr-3">{p.configured?<span className="chip chip-buy">YES</span>:<span className="chip chip-sell">NO</span>}</td>
                <td className="py-2 pr-3">{p.reachable?<span className="chip chip-buy">YES</span>:<span className="chip chip-muted">NO</span>}</td>
                <td className="py-2 pr-3">{p.auth_valid?<span className="chip chip-buy">OK</span>:<span className="chip chip-sell">FAIL</span>}</td>
                <td className="py-2 pr-3">{p.endpoint_valid?<span className="chip chip-buy">OK</span>:<span className="chip chip-muted">—</span>}</td>
                <td className="py-2 pr-3">
                  {p.model_valid === true && <span className="chip chip-buy">VALID</span>}
                  {p.model_valid === false && <span className="chip chip-wait">NOT FOUND</span>}
                  {p.model_valid === undefined && <span className="chip chip-muted">n/a</span>}
                  {p.note && <div className="muted text-[11px] mt-1 max-w-xs">{p.note}</div>}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{p.latency_ms != null ? `${p.latency_ms} ms` : "—"}</td>
                <td className="py-2 pr-3 text-xs">{p.last_success_at ? new Date(p.last_success_at).toLocaleTimeString() : "—"}</td>
                <td className="py-2 pr-3 text-xs text-red-300 max-w-sm break-words">{p.last_error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
