import "server-only";
import { NextResponse } from "next/server";
import { fetchNews } from "@/lib/providers/news";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cls = url.searchParams.get("class") || "GOLD";
  const symbol = url.searchParams.get("symbol") || (cls === "GOLD" ? "XAU/USD" : "EUR/USD");
  const data = await fetchNews({ assetClass: cls === "GOLD" ? "GOLD" : "FOREX", symbol });
  return NextResponse.json(data);
}
