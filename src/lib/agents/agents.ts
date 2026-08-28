// The 10 specialist trading-analysis agents.
// All agents return structured JSON conforming to AgentResult schema.
// Agents receive the SAME immutable snapshot in Round 1 and must not see each other.
import "server-only";
import { callLLM, imagePartFromBase64, parseJsonFromLLM, type LLMMessage } from "../llm";
import { buildEffectiveModels } from "../model-registry";
import { readUpload } from "../db";
import type {
  AgentResult,
  AnalysisSnapshot,
  AgentInput,
  Decision,
  DataQuality,
  ModelConfig,
} from "../types";

export const AGENT_REGISTRY = [
  { number: 1,  name: "Technical Structure Agent",
    description: "Trend, HH/HL/LH/LL, BOS/CHoCH, swing structure, support/resistance." },
  { number: 2,  name: "Smart Money Concept (SMC) Agent",
    description: "Order blocks, breaker blocks, mitigation, displacement, premium/discount." },
  { number: 3,  name: "Liquidity Agent",
    description: "Buy/sell-side liquidity, equal highs/lows, sweeps, stop hunts." },
  { number: 4,  name: "Price Action Agent",
    description: "Candlestick patterns, rejection, engulfing, pin bars, breakouts." },
  { number: 5,  name: "Volume Agent",
    description: "Volume expansion/contraction, confirmation, divergence, tick-vs-real volume." },
  { number: 6,  name: "FVG & Supply/Demand Agent",
    description: "Fair value gaps, imbalances, supply/demand zones, mitigation, zone strength." },
  { number: 7,  name: "Trend & Momentum Agent",
    description: "Multi-TF trend, momentum, volatility, moving averages, RSI/MACD if data allows." },
  { number: 8,  name: "Macro & Fundamental Agent",
    description: "Rates, inflation, CB policy, USD, yields, employment — sourced from FRED." },
  { number: 9,  name: "News & Sentiment Agent",
    description: "Bullish/bearish current news, high-impact events, geopolitics." },
  { number: 10, name: "Position Trading & Risk Agent",
    description: "Suitability for position trade, entry quality, SL placement, R:R, sizing." },
] as const;

const JSON_SCHEMA_HINT = `Return STRICT JSON (no prose outside the JSON) matching:
{
  "agent_number": number,
  "agent_name": string,
  "decision": "BUY" | "SELL" | "NO_TRADE",
  "confidence": number (0-100 integer),
  "evidence": string[],
  "supporting_factors": string[],
  "contradicting_factors": string[],
  "entry_zone": { "low": number|null, "high": number|null },
  "stop_loss": number|null,
  "take_profit_1": number|null,
  "take_profit_2": number|null,
  "take_profit_3": number|null,
  "risk_reward": number|null,
  "invalidation_conditions": string[],
  "data_quality": "HIGH"|"MEDIUM"|"LOW"|"INSUFFICIENT",
  "warnings": string[]
}`;

const BASE_RULES = `
YOU ARE A SPECIALIST TRADING ANALYST FOR POSITION TRADING IN GOLD AND FOREX.
HIGHEST PRIORITY RULES:
1) NEVER fabricate prices, candles, indicators, news, macro values, or entries.
2) If required data is unavailable, say so explicitly in warnings and set decision to NO_TRADE
   unless sufficient chart evidence exists from the screenshot alone.
3) Distinguish clearly between:
   - What is VISIBLE in the screenshot (direct evidence)
   - What is PROVIDED by market/news/macro data (labeled with source)
   - What is ASSUMED or SPECULATIVE (mark as POSSIBLE, not CONFIRMED)
4) Do NOT invent indicator values (RSI/MACD/MA). Only cite them if explicitly visible
   in the screenshot OR calculated from supplied market candles.
5) confidence is your own epistemic confidence (0-100) in the decision, NOT a probability of profit.
6) NO_TRADE is always a valid outcome. Prefer NO_TRADE over a weakly-supported BUY/SELL.
7) Stop loss must be based on market structure (swing invalidation, OB, S/R, FVG, liquidity),
   not arbitrary percentages, when evidence is available.
8) Targets must be based on structure/liquidity/FVG/S/D, not arbitrary percentages.
9) risk_reward must be null if entry or stop_loss or TP1 is not defined by real evidence.
10) This is analysis, not financial advice. Never guarantee profit.
`;

function buildUserContext(snap: AnalysisSnapshot): string {
  const market = snap.market;
  const news = snap.news;
  const macro = snap.macro;
  const lines: string[] = [];
  lines.push(`=== FROZEN ANALYSIS SNAPSHOT (session ${snap.session_id}) ===`);
  lines.push(`Instrument: ${snap.instrument.assetClass} - ${snap.instrument.symbol}`);
  lines.push(`User-selected timeframe: ${snap.user_timeframe}`);
  lines.push(`Detected timeframe from screenshot: ${snap.detected_timeframe ?? "UNKNOWN"}`);
  lines.push(`Timeframe mismatch: ${snap.timeframe_mismatch ? "YES — using detected timeframe" : "NO"}`);
  lines.push(`Timeframe used for analysis: ${snap.timeframe_used}`);
  lines.push(`Snapshot timestamp (UTC): ${snap.created_at}`);
  lines.push(`Risk amount: ${snap.risk.riskAmount ?? "NOT PROVIDED"}`);
  lines.push(`Account balance: ${snap.risk.accountBalance ?? "NOT PROVIDED"}`);
  lines.push(`Desired profit: ${snap.risk.desiredProfit ?? "NOT PROVIDED"}`);
  lines.push("");
  lines.push(`--- MARKET DATA (source: ${market.source ?? "none"}) ---`);
  if (market.status === "OK" && market.candles && market.candles.length > 0) {
    const c = market.candles;
    lines.push(`Candles available: ${c.length} (${c[0].timestamp} → ${c[c.length-1].timestamp})`);
    const last = c[c.length-1];
    lines.push(`Last close: ${last.close}, high: ${last.high}, low: ${last.low}`);
    // Provide compact last 60 bars as CSV for agents that need numeric data
    const tail = c.slice(-60);
    lines.push("Last candles (CSV: datetime,open,high,low,close,volume?):");
    for (const k of tail) {
      lines.push(`${k.timestamp},${k.open},${k.high},${k.low},${k.close}${k.volume!=null?","+k.volume:""}`);
    }
    lines.push(`Data freshness: ${market.fetchedAt}`);
  } else {
    lines.push(`Market status: ${market.status}`);
    lines.push(`Reason: ${market.error ?? market.note ?? "No candles."}`);
  }
  lines.push("");
  lines.push("--- NEWS DATA ---");
  if (news.status === "OK" && news.items && news.items.length > 0) {
    for (const n of news.items) {
      lines.push(`- [${n.publishedAt}] (${n.source}, ${n.sentiment}, impact ${n.potentialImpact}) ${n.headline}${n.url? " "+n.url:""}`);
    }
    lines.push(`News freshness: ${news.fetchedAt}`);
  } else {
    lines.push(`News status: ${news.status}. ${news.error ?? ""}`);
  }
  lines.push("");
  lines.push("--- MACRO DATA (FRED) ---");
  if (macro.status === "OK" && macro.series && macro.series.length > 0) {
    for (const s of macro.series) {
      const lat = s.latest;
      lines.push(`- ${s.seriesId} (${s.title}): latest = ${lat?.value ?? "n/a"} @ ${lat?.date ?? "n/a"}  (points: ${s.points.length})`);
    }
    lines.push(`Macro freshness: ${macro.fetchedAt}`);
  } else {
    lines.push(`Macro status: ${macro.status}. ${macro.error ?? ""}`);
  }
  lines.push("");
  lines.push("=== END SNAPSHOT ===");
  return lines.join("\n");
}

function specialistSystemPrompt(agent: {number:number;name:string;description:string}): string {
  return `${BASE_RULES}

YOUR ROLE: AGENT ${agent.number} — ${agent.name.toUpperCase()}
Specialty: ${agent.description}

Analyze ONLY within your specialty. Do not claim expertise in other agents' domains.
- If a concept lies outside your specialty or evidence is insufficient, do not invent it; note it in warnings/contradicting_factors.
- Every entry in "evidence" should be traceable to either the screenshot or the supplied market/news/macro snapshot.
- ${JSON_SCHEMA_HINT}
- Set agent_number = ${agent.number} and agent_name = "${agent.name}".
`;
}

function fallbackNoTrade(agent: {number:number;name:string}, reason: string, model: ModelConfig | {provider:string;model_id:string}): AgentResult {
  return {
    agent_number: agent.number,
    agent_name: agent.name,
    model_used: model.model_id,
    provider_used: model.provider,
    decision: "NO_TRADE",
    confidence: 0,
    evidence: [],
    supporting_factors: [],
    contradicting_factors: [],
    entry_zone: { low: null, high: null },
    stop_loss: null,
    take_profit_1: null,
    take_profit_2: null,
    take_profit_3: null,
    risk_reward: null,
    invalidation_conditions: [],
    data_quality: "INSUFFICIENT",
    warnings: [reason],
    error: reason,
  };
}

function sanitizeResult(obj: any, agent: {number:number;name:string}, model: ModelConfig | {provider:string;model_id:string}, latency: number): AgentResult {
  const decision: Decision =
    obj?.decision === "BUY" || obj?.decision === "SELL" ? obj.decision : "NO_TRADE";
  const dq: DataQuality =
    obj?.data_quality === "HIGH" || obj?.data_quality === "MEDIUM" || obj?.data_quality === "LOW" || obj?.data_quality === "INSUFFICIENT"
      ? obj.data_quality : "LOW";
  const conf = typeof obj?.confidence === "number" ? Math.max(0, Math.min(100, Math.round(obj.confidence))) : 0;
  const numOrNull = (v: any) => typeof v === "number" && isFinite(v) ? v : null;
  return {
    agent_number: agent.number,
    agent_name: obj?.agent_name || agent.name,
    model_used: model.model_id,
    provider_used: model.provider,
    decision,
    confidence: conf,
    evidence: Array.isArray(obj?.evidence) ? obj.evidence.map(String) : [],
    supporting_factors: Array.isArray(obj?.supporting_factors) ? obj.supporting_factors.map(String) : [],
    contradicting_factors: Array.isArray(obj?.contradicting_factors) ? obj.contradicting_factors.map(String) : [],
    entry_zone: {
      low: numOrNull(obj?.entry_zone?.low),
      high: numOrNull(obj?.entry_zone?.high),
    },
    stop_loss: numOrNull(obj?.stop_loss),
    take_profit_1: numOrNull(obj?.take_profit_1),
    take_profit_2: numOrNull(obj?.take_profit_2),
    take_profit_3: numOrNull(obj?.take_profit_3),
    risk_reward: numOrNull(obj?.risk_reward),
    invalidation_conditions: Array.isArray(obj?.invalidation_conditions) ? obj.invalidation_conditions.map(String) : [],
    data_quality: dq,
    warnings: Array.isArray(obj?.warnings) ? obj.warnings.map(String) : [],
    latency_ms: latency,
  };
}

/** Decide which model an agent uses. Agents 1-4 and 6 are chart-heavy and prefer a vision model when available. */
function pickModelFor(agentNum: number, models: ReturnType<typeof buildEffectiveModels>): ModelConfig | null {
  const needsVision = [1, 2, 3, 4, 6].includes(agentNum);
  if (needsVision && models.vision?.enabled && models.vision.supports_image) return models.vision;
  if (models.text.enabled) return models.text;
  // Fall back to vision model as a text model if it's available
  if (models.vision?.enabled) return models.vision;
  return null;
}

/** Run all 10 agents INDEPENDENTLY against the same frozen snapshot. No agent sees others' output. */
export async function runRound1(snapshot: AnalysisSnapshot, onProgress?: (msg: string, pct: number) => void): Promise<AgentResult[]> {
  const models = buildEffectiveModels();
  const screenshotBuf = snapshot.screenshot ? readUpload(snapshot.screenshot.filename) : null;
  const imageB64 = screenshotBuf?.toString("base64");
  const mime = snapshot.screenshot?.mimeType ?? "image/png";

  const context = buildUserContext(snapshot);

  const results: AgentResult[] = [];

  for (let i = 0; i < AGENT_REGISTRY.length; i++) {
    const agent = AGENT_REGISTRY[i];
    onProgress?.(`Running Agent ${agent.number}/10 — ${agent.name}...`, 30 + Math.round((i / AGENT_REGISTRY.length) * 50));

    const model = pickModelFor(agent.number, models);
    if (!model) {
      results.push(
        fallbackNoTrade(agent, "ANALYSIS_UNAVAILABLE: no LLM provider is configured with a valid API key and model.", {provider:"none",model_id:"none"})
      );
      continue;
    }

    const system = specialistSystemPrompt(agent);
    const userText = `${context}

Now, as Agent ${agent.number} (${agent.name}), produce your independent Round-1 analysis.
Remember: you have NOT seen any other agent's opinion. Do not reference other agents.
Return the JSON object only.`;

    const messages: LLMMessage[] = [
      { role: "system", content: system },
    ];
    if (needsImage(agent.number) && imageB64 && model.supports_image) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userText + "\n\nUse the attached chart screenshot as primary visual evidence." },
          imagePartFromBase64(imageB64, mime),
        ],
      });
    } else {
      if (needsImage(agent.number) && (!model.supports_image || !imageB64)) {
        // If a chart-dependent agent lacks vision, it must rely on market data only.
        messages.push({
          role: "user",
          content: userText +
            "\n\nNOTE: chart vision is not available for this call. You MUST rely on the supplied market/news/macro snapshot only. If that is insufficient for your specialty, return NO_TRADE with data_quality=INSUFFICIENT.",
        });
      } else {
        messages.push({ role: "user", content: userText });
      }
    }

    const start = Date.now();
    const res = await callLLM(model, messages, {
      temperature: 0.2,
      maxTokens: 2500,
      jsonMode: true,
      sessionId: snapshot.session_id,
      agentLabel: `agent-${agent.number}`,
      retries: 1,
    });
    const latency = Date.now() - start;
    if (res.error || !res.text) {
      results.push(fallbackNoTrade(agent, `LLM error (${model.provider}/${model.model_id}): ${res.error ?? "empty response"}`, model));
      continue;
    }
    const parsed = parseJsonFromLLM<any>(res.text);
    if (!parsed || typeof parsed !== "object") {
      results.push(fallbackNoTrade(agent, `Agent returned invalid JSON: ${res.text.slice(0,300)}`, model));
      continue;
    }
    results.push(sanitizeResult(parsed, agent, model, latency));
  }
  return results;
}

function needsImage(n: number): boolean {
  return [1, 2, 3, 4, 6, 7].includes(n);
}
