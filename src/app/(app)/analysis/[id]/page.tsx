import { notFound } from "next/navigation";
import AnalysisView from "@/components/AnalysisView";
import { getSession } from "@/lib/db";
import { parseSession } from "@/lib/orchestrator";

async function fetchInitial(id: string) {
  // In Next server component, fetch via internal route or directly via db.
  const s = getSession(id);
  if (!s) return null;
  const { snapshot, agents, debate, contradictions, decision } = parseSession(s);
  const safeSnap = {
    ...snapshot,
    screenshot: snapshot.screenshot ? {
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
    } : null,
    configured_models: {
      vision_model: snapshot.configured_models.vision_model ? { provider: snapshot.configured_models.vision_model.provider, model_id: snapshot.configured_models.vision_model.model_id } : null,
      text_models: (snapshot.configured_models.text_models || []).map((m:any) => ({ provider: m.provider, model_id: m.model_id })),
      judge_model: snapshot.configured_models.judge_model ? { provider: snapshot.configured_models.judge_model.provider, model_id: snapshot.configured_models.judge_model.model_id } : null,
    },
  };
  return {
    session_id: s.session_id,
    created_at: s.created_at,
    completed_at: s.completed_at,
    status: s.status,
    progress: s.progress,
    progress_message: s.progress_message,
    error: s.error,
    snapshot: safeSnap,
    agents, debate, contradictions, decision,
  };
}

export default async function AnalysisPage({ params }: { params: { id: string } }) {
  const initial = await fetchInitial(params.id);
  if (!initial) return notFound();
  return (
    <div>
      <AnalysisView sessionId={params.id} initial={initial as any} />
    </div>
  );
}
