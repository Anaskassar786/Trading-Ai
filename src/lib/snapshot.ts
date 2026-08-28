// Immutable analysis snapshot construction.
// Freezes screenshot, detected timeframe, market/news/macro data, risk settings, and
// configured models at the moment the analysis starts. All 10 agents MUST receive
// this exact same object; no live refresh mid-analysis.
import "server-only";
import { newId } from "./db";
import { fetchMarketData } from "./providers/market";
import { fetchNews } from "./providers/news";
import { fetchMacro } from "./providers/macro";
import { buildEffectiveModels } from "./model-registry";
import { isTestMode } from "./env";
import type {
  AnalysisSnapshot,
  AnalysisSession,
  Instrument,
  RiskSettings,
  ScreenshotInfo,
  Timeframe,
} from "./types";

export async function buildSnapshot(inputs: {
  screenshot: ScreenshotInfo | null;
  instrument: Instrument;
  userTimeframe: Timeframe;
  risk: RiskSettings;
}): Promise<{ session: AnalysisSession; snapshot: AnalysisSnapshot }> {
  const session_id = newId("sess");
  const created_at = new Date().toISOString();

  // Timeframe mismatch logic
  const detected = inputs.screenshot?.detectedTimeframe;
  const user = inputs.userTimeframe;
  const mismatch = Boolean(detected && detected !== user);
  // Use DETECTED timeframe when mismatch (per spec "auto-continue uses detected").
  const timeframe_used: Timeframe = (mismatch ? detected : user) ?? user;

  const models = buildEffectiveModels();
  const testMode = isTestMode();

  const snapshot: AnalysisSnapshot = {
    session_id,
    created_at,
    screenshot: inputs.screenshot,
    instrument: inputs.instrument,
    user_timeframe: user,
    detected_timeframe: detected,
    timeframe_mismatch: mismatch,
    timeframe_used,
    // These will be filled after parallel fetch
    market: { status: "DATA_UNAVAILABLE", error: "Not fetched yet." },
    news: { status: "DATA_UNAVAILABLE", error: "Not fetched yet.", queryTerms: [] },
    macro: { status: "DATA_UNAVAILABLE", error: "Not fetched yet." },
    risk: inputs.risk,
    configured_models: {
      vision_model: models.vision,
      text_models: [models.text].filter(Boolean) as any,
      judge_model: models.judge,
    },
    test_mode: testMode,
  };

  const session: AnalysisSession = {
    session_id,
    created_at,
    snapshot_json: JSON.stringify(snapshot),
    status: "CREATED",
    progress: 0,
    progress_message: "Session created.",
  };

  return { session, snapshot };
}

export async function hydrateSnapshotWithLiveData(
  snapshot: AnalysisSnapshot,
  onProgress?: (msg: string, pct: number) => void
): Promise<AnalysisSnapshot> {
  onProgress?.("Fetching market data (Twelve Data)...", 10);
  const market = await fetchMarketData(
    snapshot.instrument.symbol,
    snapshot.timeframe_used,
    snapshot.session_id
  );
  onProgress?.("Fetching news (News API)...", 18);
  const news = await fetchNews(snapshot.instrument, snapshot.session_id);
  onProgress?.("Fetching macro data (FRED)...", 25);
  const macro = await fetchMacro(snapshot.instrument, snapshot.session_id);
  return { ...snapshot, market, news, macro };
}
