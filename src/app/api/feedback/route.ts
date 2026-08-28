// POST /api/feedback — record WIN/LOSS/BREAKEVEN/SKIPPED outcome for a session.
// Does NOT mutate the original prediction.
import "server-only";
import { NextResponse } from "next/server";
import { getSession, saveOutcome, newId } from "@/lib/db";
import type { TradeOutcome } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { session_id, result, actual_entry, actual_exit, actual_pl, notes } = body || {};
  if (!session_id) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  if (!["WIN","LOSS","BREAKEVEN","SKIPPED"].includes(result)) {
    return NextResponse.json({ error: "result must be WIN/LOSS/BREAKEVEN/SKIPPED" }, { status: 400 });
  }
  const s = getSession(session_id);
  if (!s) return NextResponse.json({ error: "session not found" }, { status: 404 });

  // Lightweight error analysis
  let error_analysis: TradeOutcome["error_analysis"] | undefined;
  if (result === "LOSS") {
    error_analysis = {
      wrong_assumptions: ["To be reviewed by user — system does not auto-modify agent rules."],
      failed_setup: notes ? `User notes: ${notes}` : undefined,
    };
  }
  const outcome: TradeOutcome = {
    id: newId("out"),
    session_id,
    recorded_at: new Date().toISOString(),
    result,
    actual_entry: typeof actual_entry === "number" ? actual_entry : undefined,
    actual_exit: typeof actual_exit === "number" ? actual_exit : undefined,
    actual_pl: typeof actual_pl === "number" ? actual_pl : undefined,
    notes: typeof notes === "string" ? notes : undefined,
    error_analysis,
  };
  saveOutcome(outcome);
  return NextResponse.json({ ok: true, outcome });
}
