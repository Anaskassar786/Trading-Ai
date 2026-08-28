// GET /api/ping — lightweight health check for Render (and other platforms).
// Makes ZERO external API calls: just proves the Node server is up and able
// to route requests. Use this as the Render Health Check Path.
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "trading-ai-ak",
    time: new Date().toISOString(),
  });
}
