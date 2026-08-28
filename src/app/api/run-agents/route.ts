// POST /api/run-agents { session_id }
// Kicks off (or resumes) the Round 1 → Debate → Chief Judge pipeline for a session.
// Returns immediately with { ok: true } — clients poll /api/sessions/[id] for progress.

import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/db";
import { runSession } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

// In-memory guard so we don't double-run the same session on concurrent triggers.
// Fine for a single-instance personal tool.
const running = new Set<string>();

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = body?.session_id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  const s = getSession(id);
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (s.status === "COMPLETED" || s.status === "FAILED") {
    return NextResponse.json({ ok: true, status: s.status, already: true });
  }
  if (running.has(id)) {
    return NextResponse.json({ ok: true, status: s.status, already: true });
  }

  // Fire-and-forget the pipeline so the HTTP response returns quickly.
  running.add(id);
  (async () => {
    try {
      await runSession(id);
    } finally {
      running.delete(id);
    }
  })();

  return NextResponse.json({ ok: true, status: "RUNNING" });
}
