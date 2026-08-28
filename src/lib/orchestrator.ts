// End-to-end analysis orchestrator.
// Builds an immutable snapshot, runs Round 1 (10 independent agents),
// Round 2 debate, and Round 3 Chief Judge; persists progress at each step.
// All stages are resumable/visible via the /api/sessions/[id] endpoint.

import "server-only";
import { getSession, saveSession, newId } from "./db";
import { buildSnapshot, hydrateSnapshotWithLiveData } from "./snapshot";
import { runRound1 } from "./agents/agents";
import { runDebate } from "./agents/debate";
import { runChiefJudge } from "./agents/judge";
import type {
  AnalysisSession,
  Instrument,
  RiskSettings,
  ScreenshotInfo,
  Timeframe,
  AgentResult,
  DebateTurn,
  Contradiction,
  FinalDecision,
} from "./types";

export interface NewAnalysisInput {
  screenshot: ScreenshotInfo | null;
  instrument: Instrument;
  userTimeframe: Timeframe;
  risk: RiskSettings;
}

export type ProgressCb = (msg: string, pct: number) => void;

/** Create a new session (frozen snapshot) but don't run any agents yet.
 *  The caller decides whether to run synchronously or in the background. */
export async function createSession(input: NewAnalysisInput): Promise<AnalysisSession> {
  const { session, snapshot } = await buildSnapshot(input);
  session.snapshot_json = JSON.stringify(snapshot);
  session.status = "CREATED";
  session.progress = 1;
  session.progress_message = "Session created. Preparing screenshot...";
  saveSession(session);
  return session;
}

/** Execute the full pipeline against an existing session.
 *  Progress is persisted incrementally so clients can poll. */
export async function runSession(sessionId: string): Promise<AnalysisSession> {
  let session = getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const setProgress = (msg: string, pct: number) => {
    session.progress = Math.max(0, Math.min(100, Math.round(pct)));
    session.progress_message = msg;
    session.status = session.status === "FAILED" || session.status === "COMPLETED"
      ? session.status
      : progressStatusFor(pct);
    saveSession({ ...session });
  };

  try {
    // --- Stage 1: snapshot already exists, fetch data -----------------------
    const snap = JSON.parse(session.snapshot_json) as ReturnType<typeof JSON.parse>;

    setProgress("Preparing screenshot...", 3);
    if (snap.screenshot) setProgress("Screenshot locked. Detecting timeframe...", 6);
    else setProgress("No screenshot supplied. Will rely on live data only.", 6);

    setProgress("Fetching market data (Twelve Data)...", 10);
    setProgress("Fetching news (News API)...", 16);
    setProgress("Fetching macro data (FRED)...", 22);
    const hydrated = await hydrateSnapshotWithLiveData(snap, setProgress);
    session.snapshot_json = JSON.stringify(hydrated);
    setProgress("Snapshot frozen.", 28);

    // --- Stage 2: 10 agents --------------------------------------------------
    setProgress("Running Agent 1/10 — Technical Structure...", 30);
    const agents: AgentResult[] = await runRound1(hydrated, (msg, pct) => {
      // runRound1 reports ~30..80 already
      setProgress(msg, pct);
    });
    session.agents_json = JSON.stringify(agents);
    setProgress("Round 1 complete. Building adversarial debate...", 82);

    // --- Stage 3: debate -----------------------------------------------------
    const { turns, contradictions } = await runDebate(hydrated, agents, setProgress);
    session.debate_json = JSON.stringify(turns);
    session.contradictions_json = JSON.stringify(contradictions);
    setProgress("Debate complete. Chief Judge analyzing...", 90);

    // --- Stage 4: Chief Judge ------------------------------------------------
    const decision: FinalDecision = await runChiefJudge(
      hydrated,
      agents,
      turns,
      contradictions,
      setProgress,
    );
    session.decision_json = JSON.stringify(decision);
    setProgress("Generating final report...", 97);

    session.status = "COMPLETED";
    session.completed_at = new Date().toISOString();
    session.progress = 100;
    session.progress_message = "Final report ready.";
    saveSession({ ...session });
    return session;
  } catch (err: any) {
    session.status = "FAILED";
    session.error = String(err?.message ?? err);
    session.progress_message = `Failed: ${session.error}`;
    saveSession({ ...session });
    return session;
  }
}

function progressStatusFor(pct: number): AnalysisSession["status"] {
  if (pct < 28) return "SNAPSHOT_READY";
  if (pct < 80) return "AGENTS_RUNNING";
  if (pct < 88) return "DEBATING";
  if (pct < 97) return "JUDGING";
  return "COMPLETED";
}

export function parseSession(session: AnalysisSession) {
  const snapshot = JSON.parse(session.snapshot_json);
  const agents: AgentResult[] = session.agents_json ? JSON.parse(session.agents_json) : [];
  const debate: DebateTurn[] = session.debate_json ? JSON.parse(session.debate_json) : [];
  const contradictions: Contradiction[] = session.contradictions_json
    ? JSON.parse(session.contradictions_json)
    : [];
  const decision: FinalDecision | null = session.decision_json
    ? JSON.parse(session.decision_json)
    : null;
  return { snapshot, agents, debate, contradictions, decision };
}
