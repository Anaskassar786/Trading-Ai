// GET /api/health — run live health checks for all 7 providers. Never exposes keys.
import "server-only";
import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/providers/health";
import { setHealthCache, getHealthCache } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  if (!force) {
    const cached = getHealthCache();
    const cachedArr = Object.values(cached);
    if (cachedArr.length === 7) {
      return NextResponse.json({ providers: cachedArr, cached: true });
    }
  }
  const results = await runHealthChecks();
  const map: Record<string, any> = {};
  for (const r of results) map[r.provider] = r;
  setHealthCache(map);
  return NextResponse.json({ providers: results, cached: false });
}
