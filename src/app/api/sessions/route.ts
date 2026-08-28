// GET /api/sessions — list recent sessions (no secrets, no keys).
import "server-only";
import { NextResponse } from "next/server";
import { listSessions } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const all = listSessions().slice(0, 100).map((s) => ({
    session_id: s.session_id,
    created_at: s.created_at,
    completed_at: s.completed_at,
    status: s.status,
    progress: s.progress,
    progress_message: s.progress_message,
    final_decision: s.decision_json ? (JSON.parse(s.decision_json).final_decision ?? null) : null,
  }));
  return NextResponse.json({ sessions: all });
}
