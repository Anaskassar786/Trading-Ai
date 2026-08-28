// GET/POST /api/settings — model routing and test mode.
// Never accepts or stores API keys.
import "server-only";
import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { hasEnv } from "@/lib/env";
import { VISION_CHAIN, TEXT_CHAIN, JUDGE_CHAIN } from "@/lib/fallback-chain";

export const runtime = "nodejs";

export async function GET() {
  const s = getSettings();
  const publicChain = (chain: readonly { provider: string; model_id: string }[]) =>
    chain.map(({ provider, model_id }) => ({ provider, model_id }));
  return NextResponse.json({
    settings: s,
    fallback_chains: {
      vision: publicChain(VISION_CHAIN),
      text: publicChain(TEXT_CHAIN),
      judge: publicChain(JUDGE_CHAIN),
    },
    providers_available: {
      nvidia: hasEnv("NVIDIA_API_KEY"),
      openrouter: hasEnv("OPENROUTER_API_KEY"),
      gemini: hasEnv("GEMINI_API_KEY"),
      minimax: hasEnv("MINIMAX_API_KEY"),
      twelvedata: hasEnv("TWELVE_DATA_API_KEY"),
      fred: hasEnv("FRED_API_KEY"),
      newsapi: hasEnv("NEWS_API_KEY"),
    },
  });
}

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const s = getSettings();
  const allowedProviders = new Set(["nvidia","openrouter","gemini","minimax"]);
  function validateSlot(slot: any) {
    if (!slot) return null;
    if (!allowedProviders.has(slot.provider)) return null;
    if (typeof slot.model_id !== "string" || slot.model_id.length === 0) return null;
    return { provider: slot.provider, model_id: slot.model_id };
  }
  const next = {
    models: {
      vision: validateSlot(body?.models?.vision) ?? s.models.vision,
      text: validateSlot(body?.models?.text) ?? s.models.text,
      judge: validateSlot(body?.models?.judge) ?? s.models.judge,
    },
    testMode: typeof body?.testMode === "boolean" ? body.testMode : s.testMode,
  };
  saveSettings(next);
  return NextResponse.json({ ok: true, settings: next });
}
