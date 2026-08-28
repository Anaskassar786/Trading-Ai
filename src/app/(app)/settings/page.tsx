"use client";
import { useEffect, useState } from "react";

type Slot = { provider: string; model_id: string } | null;
type Settings = {
  models: { vision: Slot; text: Slot; judge: Slot };
  testMode: boolean;
};
type Avail = Record<string, boolean>;

const PROVIDERS = ["nvidia","openrouter","gemini","minimax"] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [avail, setAvail] = useState<Avail>({});
  const [msg, setMsg] = useState<string|null>(null);

  useEffect(()=>{(async()=>{
    const r = await fetch("/api/settings", {cache:"no-store"});
    const j = await r.json();
    setSettings(j.settings); setAvail(j.providers_available);
  })();},[]);

  function setSlot(which: "vision"|"text"|"judge", provider: string, model_id: string) {
    setSettings(s => s ? {...s, models: {...s.models, [which]: {provider, model_id}}} : s);
  }

  async function save() {
    setMsg(null);
    const r = await fetch("/api/settings", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(settings)});
    const j = await r.json();
    setMsg(r.ok?"Saved.":(j.error||"Failed"));
  }

  if (!settings) return <div className="muted">Loading…</div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="card space-y-4">
        <p className="muted">
          Model routing is configured here. API keys are set via server-side environment variables
          (<span className="kbd">NVIDIA_API_KEY</span>, <span className="kbd">OPENROUTER_API_KEY</span>, <span className="kbd">GEMINI_API_KEY</span>, etc.)
          and never shown here. If a provider is not configured, it is not used.
        </p>
        {(["vision","text","judge"] as const).map(slot => {
          const cur = settings.models[slot];
          return (
            <div key={slot} className="panel">
              <div className="label capitalize">{slot} model {slot==="vision"&&<span className="text-slate-500 normal-case">— must support image input for chart analysis</span>}</div>
              <div className="flex gap-2 flex-wrap">
                <select className="input max-w-[200px]" value={cur?.provider ?? ""} onChange={(e)=>setSlot(slot, e.target.value, cur?.model_id ?? "")}>
                  <option value="">(disabled)</option>
                  {PROVIDERS.map(p => <option key={p} value={p} disabled={!avail[p]}>{p}{avail[p]?"":" (no key)"}</option>)}
                </select>
                <input className="input flex-1" placeholder="Model ID (e.g. minimaxai/minimax-m3)"
                  value={cur?.model_id ?? ""}
                  onChange={(e)=>setSlot(slot, cur?.provider ?? "nvidia", e.target.value)} />
              </div>
            </div>
          );
        })}

        <div className="panel flex items-center gap-3">
          <input type="checkbox" id="testMode" checked={settings.testMode} onChange={(e)=>setSettings({...settings, testMode:e.target.checked})} />
          <label htmlFor="testMode" className="text-sm">
            <strong>Test mode</strong> — mock/allow-offline analysis only. All output is clearly labeled TEST DATA and must NOT be traded.
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={save}>Save settings</button>
          {msg && <span className="muted text-xs">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
