// Shared type definitions for the Trading AI AK system.

export type Decision = "BUY" | "SELL" | "NO_TRADE";
export type DataQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type Timeframe =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w";

export type Instrument = {
  assetClass: "GOLD" | "FOREX";
  symbol: string; // e.g. XAU/USD, EUR/USD
};

export interface PriceCandle {
  timestamp: string; // ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketSnapshot {
  status: "OK" | "DATA_UNAVAILABLE" | "INSUFFICIENT_DATA";
  symbol?: string;
  timeframe?: Timeframe;
  candles?: PriceCandle[];
  source?: string;
  fetchedAt?: string;
  error?: string;
  note?: string;
}

export interface NewsItem {
  headline: string;
  source: string;
  publishedAt: string;
  url?: string;
  relevance?: string;
  sentiment?: "bullish" | "bearish" | "neutral" | "unknown";
  potentialImpact?: "high" | "medium" | "low" | "unknown";
}

export interface NewsSnapshot {
  status: "OK" | "DATA_UNAVAILABLE";
  items?: NewsItem[];
  fetchedAt?: string;
  error?: string;
  queryTerms?: string[];
}

export interface MacroSeriesPoint {
  date: string;
  value: number | null;
}

export interface MacroSeries {
  seriesId: string;
  title: string;
  units?: string;
  frequency?: string;
  points: MacroSeriesPoint[];
  latest?: { date: string; value: number | null };
}

export interface MacroSnapshot {
  status: "OK" | "DATA_UNAVAILABLE";
  series?: MacroSeries[];
  fetchedAt?: string;
  error?: string;
}

export interface ScreenshotInfo {
  filename: string; // stored filename
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  detectedSymbol?: string;
  detectedTimeframe?: Timeframe;
  detectedPlatform?: string;
  visionDescription?: string;
  detectionConfidence?: number; // 0-100
}

export interface AgentInput {
  snapshot: AnalysisSnapshot;
}

export interface EntryZone {
  low: number | null;
  high: number | null;
}

export interface AgentResult {
  agent_number: number;
  agent_name: string;
  model_used: string;
  provider_used: string;
  decision: Decision;
  confidence: number; // 0-100
  evidence: string[];
  supporting_factors: string[];
  contradicting_factors: string[];
  entry_zone: EntryZone;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  take_profit_3: number | null;
  risk_reward: number | null;
  invalidation_conditions: string[];
  data_quality: DataQuality;
  warnings: string[];
  latency_ms?: number;
  error?: string;
}

export interface DebateTurn {
  id: string;
  challenger_agent: number;
  challenged_agent: number;
  claim: string; // the concrete claim being challenged
  counterclaim: string;
  evidence: string;
  assessment: string;
  winner_side?: Decision | "UNRESOLVED";
  confidence_change?: number;
  model_used: string;
  provider_used: string;
}

export interface Contradiction {
  topic: string;
  confirmed_fact?: string;
  conflicting_claim_a: { agent: number; claim: string };
  conflicting_claim_b: { agent: number; claim: string };
  resolution?: string;
  status: "CONFIRMED_FACT" | "CONFLICTING" | "UNRESOLVED";
}

export interface FinalDecision {
  final_decision: Decision;
  vote_distribution: { buy: number; sell: number; no_trade: number };
  final_confidence: number;
  entry: EntryZone;
  stop_loss: number | null;
  targets: { tp1: number | null; tp2: number | null; tp3: number | null };
  risk_amount: number | null;
  position_size: number | null;
  risk_reward: number | null;
  decision_summary: string;
  strongest_bullish_arguments: string[];
  strongest_bearish_arguments: string[];
  rejected_arguments: string[];
  invalidation_conditions: string[];
  warnings: string[];
  data_quality: DataQuality | "DATA_UNAVAILABLE";
  data_freshness?: string;
  model_used: string;
  provider_used: string;
  latency_ms?: number;
}

export interface RiskSettings {
  riskAmount: number | null;
  accountBalance: number | null;
  desiredProfit: number | null;
}

export interface AnalysisSnapshot {
  session_id: string;
  created_at: string;
  screenshot: ScreenshotInfo | null;
  instrument: Instrument;
  user_timeframe: Timeframe;
  detected_timeframe?: Timeframe;
  timeframe_mismatch: boolean;
  timeframe_used: Timeframe;
  market: MarketSnapshot;
  news: NewsSnapshot;
  macro: MacroSnapshot;
  risk: RiskSettings;
  configured_models: {
    vision_model: ModelConfig | null;
    text_models: ModelConfig[];
    judge_model: ModelConfig | null;
  };
  test_mode: boolean;
}

export interface ModelConfig {
  id: string;
  provider: "nvidia" | "openrouter" | "gemini" | "minimax";
  model_id: string;
  base_url?: string;
  api_key_env: string;
  supports_image: boolean;
  supports_reasoning: boolean;
  supports_structured_output: boolean;
  enabled: boolean;
  priority: number;
  role?: string;
}

export interface AnalysisSession {
  session_id: string;
  created_at: string;
  snapshot_json: string;
  status:
    | "CREATED"
    | "SNAPSHOT_READY"
    | "AGENTS_RUNNING"
    | "DEBATING"
    | "JUDGING"
    | "COMPLETED"
    | "FAILED";
  progress: number; // 0-100
  progress_message: string;
  error?: string;
  agents_json?: string; // AgentResult[]
  debate_json?: string; // DebateTurn[]
  contradictions_json?: string; // Contradiction[]
  decision_json?: string; // FinalDecision
  completed_at?: string;
}

export interface TradeOutcome {
  id: string;
  session_id: string;
  recorded_at: string;
  result: "WIN" | "LOSS" | "BREAKEVEN" | "SKIPPED";
  actual_entry?: number;
  actual_exit?: number;
  actual_pl?: number;
  notes?: string;
  error_analysis?: {
    correct_analysis?: string[];
    wrong_assumptions?: string[];
    failed_setup?: string;
    news_surprise?: boolean;
    timeframe_error?: boolean;
    liquidity_misread?: boolean;
    trend_misread?: boolean;
    invalidated_setup?: boolean;
    data_quality_issue?: boolean;
  };
}

export interface AgentRegistryEntry {
  number: number;
  name: string;
  description: string;
  required_capabilities: string[];
}

export interface ApiHealthStatus {
  provider: string;
  configured: boolean;
  reachable: boolean;
  auth_valid: boolean;
  endpoint_valid: boolean;
  model_valid?: boolean;
  last_success_at?: string;
  last_error?: string;
  latency_ms?: number;
  note?: string;
}
