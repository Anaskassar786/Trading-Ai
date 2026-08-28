"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Prov = {
  provider: string;
  configured: boolean;
  reachable: boolean;
  auth_valid: boolean;
  endpoint_valid: boolean;
  model_valid?: boolean;
  last_error?: string;
  note?: string;
};

export default function EnvironmentBanner() {
  const [providers, setProviders] = useState<Prov[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health?refresh=0", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({ providers: [] })))
      .then((j) => { if (!cancelled) setProviders(j.providers || []); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, []);

  if (!providers || dismissed) return null;

  const isLLM = (p: string) => ["nvidia","openrouter","gemini"].includes(p);
  const isData = (p: string) => ["twelvedata","fred","newsapi"].includes(p);
  const anyConfigured = providers.some((p) => p.configured);
  const anyLLMOk = providers.some((p) => isLLM(p.provider) && p.configured && p.reachable && p.auth_valid);
  const anyDataOk = providers.some((p) => isData(p.provider) && p.configured && p.reachable);
  const llmFailing = providers.filter((p) => isLLM(p.provider) && p.configured && !(p.reachable && p.auth_valid));
  const dataFailing = providers.filter((p) => isData(p.provider) && p.configured && !p.reachable);
  const unconfigured = providers.filter((p) => isLLM(p.provider) && !p.configured);

  if (!anyConfigured) {
    return (
      <div className="border border-amber-700/60 bg-amber-950/30 text-amber-200 rounded-xl p-3 text-sm flex items-start justify-between gap-2">
        <div>
          <strong>No API keys configured.</strong> Add server-side env vars
          {" "}<span className="kbd">NVIDIA_API_KEY</span>, <span className="kbd">TWELVE_DATA_API_KEY</span>,{" "}
          <span className="kbd">FRED_API_KEY</span>, <span className="kbd">NEWS_API_KEY</span>
          {" "}and restart the server. <Link href="/api-health" className="underline">API Health →</Link>
        </div>
        <button className="text-amber-200/70 hover:text-white px-2" onClick={() => setDismissed(true)} aria-label="dismiss">×</button>
      </div>
    );
  }

  if (anyConfigured && !anyLLMOk) {
    return (
      <div className="border border-red-800/60 bg-red-950/30 text-red-200 rounded-xl p-3 text-sm flex items-start justify-between gap-2">
        <div>
          <strong>External providers are unreachable from this environment.</strong>{" "}
          All LLM and data API requests are failing at the network layer (TLS connection reset).
          This is expected in sandboxed/offline environments. The council correctly returns{" "}
          <span className="kbd">NO_TRADE</span> / <span className="kbd">DATA_UNAVAILABLE</span>{" "}
          and does <em>not</em> fabricate any data, prices, news, or indicators.
          When you run this app on a host with outbound internet (your own machine, Vercel, a VPS, etc.),
          all providers will connect normally and the agents will produce real analyses.{" "}
          <Link href="/api-health" className="underline">View API Health →</Link>
        </div>
        <button className="text-red-200/70 hover:text-white px-2" onClick={() => setDismissed(true)} aria-label="dismiss">×</button>
      </div>
    );
  }

  if (llmFailing.length > 0 || dataFailing.length > 0) {
    return (
      <div className="border border-amber-700/60 bg-amber-950/30 text-amber-200 rounded-xl p-3 text-sm flex items-start justify-between gap-2">
        <div>
          <strong>Some providers are unavailable.</strong>{" "}
          {llmFailing.length>0 && <>LLM: {llmFailing.map(p=>p.provider).join(", ")} (agents will fall back to other LLM providers or NO_TRADE). </>}
          {dataFailing.length>0 && <>Data: {dataFailing.map(p=>p.provider).join(", ")} (data-dependent analyses show <span className="kbd">DATA_UNAVAILABLE</span>).</>}
          {unconfigured.length>0 && <> Unconfigured: {unconfigured.map(p=>p.provider).join(", ")}.</>}
          {" "}<Link href="/api-health" className="underline">Details →</Link>
        </div>
        <button className="text-amber-200/70 hover:text-white px-2" onClick={() => setDismissed(true)} aria-label="dismiss">×</button>
      </div>
    );
  }

  if (anyLLMOk && !anyDataOk) {
    return (
      <div className="border border-amber-700/60 bg-amber-950/30 text-amber-200 rounded-xl p-3 text-sm flex items-start justify-between gap-2">
        <div>
          <strong>LLM providers are reachable but market/news/macro data is not.</strong>{" "}
          Chart-vision analysis can still run, but agents that depend on OHLC / news / macro will mark data quality <span className="kbd">LOW</span> and the Chief Judge may return NO_TRADE.{" "}
          <Link href="/api-health" className="underline">Check data providers →</Link>
        </div>
        <button className="text-amber-200/70 hover:text-white px-2" onClick={() => setDismissed(true)} aria-label="dismiss">×</button>
      </div>
    );
  }

  return null;
}
