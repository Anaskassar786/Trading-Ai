// GET /api/sessions/[id] — return the full session (agents/debate/judge/snapshot),
// excluding raw screenshot binary (available via /api/sessions/[id]/screenshot).
// NEVER returns any API keys or secrets.
import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/db";
import { parseSession } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = getSession(params.id);
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { snapshot, agents, debate, contradictions, decision } = parseSession(s);
  // Strip screenshot binary references (client knows filename and can request via /uploads/* public route? — keep private via an API).
  const safeSnapshot = {
    ...snapshot,
    screenshot: snapshot.screenshot
      ? {
          filename: snapshot.screenshot.filename,
          originalName: snapshot.screenshot.originalName,
          mimeType: snapshot.screenshot.mimeType,
          sizeBytes: snapshot.screenshot.sizeBytes,
          detectedSymbol: snapshot.screenshot.detectedSymbol,
          detectedTimeframe: snapshot.screenshot.detectedTimeframe,
          detectedPlatform: snapshot.screenshot.detectedPlatform,
          visionDescription: snapshot.screenshot.visionDescription,
          detectionConfidence: snapshot.screenshot.detectionConfidence,
          sha256: snapshot.screenshot.sha256,
          // do NOT return base64 here — use separate route
        }
      : null,
    // Never expose configured_models' api keys; model IDs/provider names are OK
    configured_models: {
      vision_model: snapshot.configured_models.vision_model
        ? { provider: snapshot.configured_models.vision_model.provider, model_id: snapshot.configured_models.vision_model.model_id }
        : null,
      text_models: (snapshot.configured_models.text_models || []).map((m: any) => ({ provider: m.provider, model_id: m.model_id })),
      judge_model: snapshot.configured_models.judge_model
        ? { provider: snapshot.configured_models.judge_model.provider, model_id: snapshot.configured_models.judge_model.model_id }
        : null,
    },
  };
  return NextResponse.json({
    session_id: s.session_id,
    created_at: s.created_at,
    completed_at: s.completed_at,
    status: s.status,
    progress: s.progress,
    progress_message: s.progress_message,
    error: s.error,
    snapshot: safeSnapshot,
    agents,
    debate,
    contradictions,
    decision,
  });
}
