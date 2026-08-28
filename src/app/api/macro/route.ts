import "server-only";
import { NextResponse } from "next/server";
import { fetchMacro } from "@/lib/providers/macro";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cls = url.searchParams.get("class") || "GOLD";
  const symbol = url.searchParams.get("symbol") || "XAU/USD";
  const data = await fetchMacro({ assetClass: cls === "GOLD" ? "GOLD" : "FOREX", symbol });
  return NextResponse.json(data);
}
