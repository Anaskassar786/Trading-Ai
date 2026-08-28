"use client";
import { useEffect, useState } from "react";
import { buildProviderOptions, normalizeAvail, type Avail } from "@/lib/settings-options";

type Slot = { provider: string; model_id: string } | null;
type Settings = {
  models: { vision: Slot; text: Slot; judge: Slot };
  testMode: boolean;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [avail, setAvail] = useState<Avail>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        // The API returns { settings, providers_available }. Normalize BOTH so a
        // malformed/legacy payload can never blank the dropdowns or model inputs.
        const s = j?.settings;
        setSettings({
          models: {
            vision: s?.models?.vision ?? null,
            text: s?.models?.text ?? null,
            judge: s?.models?.judge ?? null,
          },
          testMode: Boolean(s?.testMode),
        });
        setAvail(normalizeAvail(j.providers_available));
      } catch (e: any) {
        setLoadError(e?.message ?? String(e));
      }
    })();
  }, []);

  function setSlot(
    which: "vision" | "text" | "judge",
    provider: string,
    model_id: string
  ) {
    setSettings((s) => {
      if (!s) return s;
      const cur = s.models[which];
      const p = provider || cur?.provider || null;
      if (!p) return s; // no provider selected → keep the slot unchanged
      return {
        ...s,
        models: {
          ...s.models,
          [which]: { provider: p, model_id: model_id || cur?.model_id || "" },
        },
      };
    });
  }

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const j = await r.json();
      setMsg(r.ok ? "Saved." : j.error || "Failed");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed");
    }
    setSaving(false);
  }

  if (loadError) {
    return (
      <div className="space-y-5 max-w-3xl">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="card text-red-300 border-red-900/60 bg-red-950/30">
          Failed to load settings: {loadError}. Refresh the page to retry.
        </div>
      </div>
    );
  }

  if (!settings) return <div className="muted">Loading…</div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="card space-y-4">
        <p className="muted">
          Model routing is configured here. API keys are set via server-side environment variables
          (<span className="kbd">NVIDIA_API_KEY</span>, <span className="kbd">OPENROUTER_API_KEY</span>, <span className="kbd">GEMINI_API_KEY</span>, etc.)
          and never shown here. Providers without a configured key are disabled and labeled
          <span className="kbd ml-1">(no key)</span>; they are not used.
        </p>
        {(["vision", "text", "judge"] as const).map((slot) => {
          const cur = settings.models[slot];
          const options = buildProviderOptions(avail, cur?.provider);
          const currentConfigured =
            cur?.provider != null && avail[cur.provider] === true;
          return (
            <div key={slot} className="panel">
              <div className="label capitalize">
                {slot} model{" "}
                {slot === "vision" && (
                  <span className="text-slate-500 normal-case">
                    — must support image input for chart analysis
                  </span>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <select
                  className="input max-w-[200px]"
                  value={cur?.provider ?? ""}
                  onChange={(e) =>
                    setSlot(slot, e.target.value, cur?.model_id ?? "")
                  }
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value} disabled={o.disabled}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input flex-1"
                  placeholder="Model ID (e.g. gemini-2.0-flash)"
                  value={cur?.model_id ?? ""}
                  disabled={!cur}
                  onChange={(e) =>
                    setSlot(slot, cur?.provider ?? "", e.target.value)
                  }
                />
              </div>
              {cur && !currentConfigured && (
                <div className="text-amber-300 text-xs mt-2">
                  Selected provider <span className="font-mono">{cur.provider}</span>{" "}
                  has no API key configured on the server — no model can be called
                  through it until the key is set (server-side env var) or another
                  provider is chosen.
                </div>
              )}
            </div>
          );
        })}

        <div className="panel flex items-center gap-3">
          <input
            type="checkbox"
            id="testMode"
            checked={settings.testMode}
            onChange={(e) =>
              setSettings({ ...settings, testMode: e.target.checked })
            }
          />
          <label htmlFor="testMode" className="text-sm">
            <strong>Test mode</strong> — mock/allow-offline analysis only. All output is clearly labeled TEST DATA and must NOT be traded.
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {msg && <span className="muted text-xs">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
