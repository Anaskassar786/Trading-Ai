// GET /api/market?symbol=XAU/USD&timeframe=1h — on-demand market snapshot.
import "server-only";
import { NextResponse } from "next/server";
import { fetchMarketData } from "@/lib/providers/market";
import type { Timeframe } from "@/lib/types";

const VALID_TF: Timeframe[] = ["1m","5m","15m","30m","1h","4h","1d","1w"];
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "XAU/USD";
  const tf = (url.searchParams.get("timeframe") || "4h").toLowerCase() as Timeframe;
  if (!VALID_TF.includes(tf)) {
    return NextResponse.json({ error: "invalid timeframe" }, { status: 400 });
  }
  const data = await fetchMarketData(symbol, tf);
  return NextResponse.json(data);
}
