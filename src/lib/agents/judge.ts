// Round 3 — the 11th independent Chief Judge AI.
// The judge evaluates evidence quality, contradictions, debate, risk, and produces
// the final BUY / SELL / NO_TRADE with full trade plan.
import "server-only";
import { callLLM, parseJsonFromLLM } from "../llm";
import { buildEffectiveModels } from "../model-registry";
import type {
  AgentResult,
  AnalysisSnapshot,
  DebateTurn,
  Contradiction,
  FinalDecision,
  Decision,
  DataQuality,
} from "../types";

function summary(r: AgentResult) {
  return `A${r.agent_number} ${r.agent_name} → ${r.decision} (${r.confidence})
  evidence: ${r.evidence.slice(0,5).join(" | ")}
  warnings: ${r.warnings.slice(0,3).join(" | ")}
  dq: ${r.data_quality}
  entry=${JSON.stringify(r.entry_zone)} sl=${r.stop_loss} tp1=${r.take_profit_1} tp2=${r.take_profit_2} tp3=${r.take_profit_3} rr=${r.risk_reward}`;
}

function calcPositionSize(
  riskAmount: number | null,
  entry: number | null,
  stop: number | null
): number | null {
  // Without instrument-spec pip sizing, we return a simple "risk per unit" value.
  // Proper position sizing for gold/forex requires contract size / pip value / lot.
  // We'll compute: units = riskAmount / |entry - stop|  (risk-per-unit model),
  // and clearly mark the methodology in warnings.
  if (riskAmount == null || entry == null || stop == null) return null;
  const dist = Math.abs(entry - stop);
  if (dist <= 0) return null;
  return Number((riskAmount / dist).toFixed(4));
}

function pickDataQuality(results: AgentResult[], snap: AnalysisSnapshot): DataQuality | "DATA_UNAVAILABLE" {
  const dqRank: Record<DataQuality, number> = { HIGH: 4, MEDIUM: 3, LOW: 2, INSUFFICIENT: 1 };
  let minDq: DataQuality = "HIGH";
  for (const r of results) {
    if (dqRank[r.data_quality] < dqRank[minDq]) minDq = r.data_quality;
  }
  if (snap.market.status !== "OK") {
    if (minDq === "HIGH" || minDq === "MEDIUM") minDq = "MEDIUM";
  }
  if (snap.news.status !== "OK") {
    // news failure doesn't automatically reduce dq below MEDIUM
  }
  if (minDq === "INSUFFICIENT" && snap.market.status !== "OK" && !snap.screenshot) {
    return "DATA_UNAVAILABLE";
  }
  return minDq;
}

export async function runChiefJudge(
  snapshot: AnalysisSnapshot,
  results: AgentResult[],
  debate: DebateTurn[],
  contradictions: Contradiction[],
  onProgress?: (msg: string, pct: number) => void
): Promise<FinalDecision> {
  onProgress?.("Chief Judge analyzing all evidence...", 90);
  const start = Date.now();
  const models = buildEffectiveModels();
  const model = models.judge?.enabled ? models.judge : (models.text.enabled ? models.text : models.vision);

  const v = results.reduce(
    (acc, r) => {
      if (r.decision === "BUY") acc.buy++;
      else if (r.decision === "SELL") acc.sell++;
      else acc.no_trade++;
      return acc;
    },
    { buy: 0, sell: 0, no_trade: 0 }
  );

  const agentErrors = results.map((r) => r.error).filter(Boolean) as string[];
  const allAgentsErrored = agentErrors.length === results.length;
  const anyAgentEvidence = results.some((r) => !r.error && r.evidence.length > 0);

  if (!model) {
    return {
      final_decision: "NO_TRADE",
      vote_distribution: v,
      final_confidence: 0,
      entry: { low: null, high: null },
      stop_loss: null,
      targets: { tp1: null, tp2: null, tp3: null },
      risk_amount: snapshot.risk.riskAmount ?? null,
      position_size: null,
      risk_reward: null,
      decision_summary: "ANALYSIS_UNAVAILABLE — no LLM provider is configured.",
      strongest_bullish_arguments: [],
      strongest_bearish_arguments: [],
      rejected_arguments: [],
      invalidation_conditions: [],
      warnings: ["No LLM provider is configured; analysis unavailable."],
      data_quality: "DATA_UNAVAILABLE",
      model_used: "none",
      provider_used: "none",
      latency_ms: Date.now() - start,
    };
  }

  // If every agent errored before producing any real evidence, do NOT make an
  // LLM call and do NOT fabricate a verdict. Return explicit ANALYSIS_UNAVAILABLE.
  if (allAgentsErrored && !anyAgentEvidence) {
    const sampleErr = agentErrors[0] ?? "unknown error";
    return {
      final_decision: "NO_TRADE",
      vote_distribution: v,
      final_confidence: 0,
      entry: { low: null, high: null },
      stop_loss: null,
      targets: { tp1: null, tp2: null, tp3: null },
      risk_amount: snapshot.risk.riskAmount ?? null,
      position_size: null,
      risk_reward: null,
      decision_summary:
        "ANALYSIS_UNAVAILABLE — all 10 specialist agents failed before producing any analysis (the LLM provider is unreachable from this environment, likely a network/auth issue). There is no real evidence for the Chief Judge to evaluate. No verdict, entry, stop loss, or target has been fabricated. Check API Health and re-run analysis when providers are reachable.",
      strongest_bullish_arguments: [],
      strongest_bearish_arguments: [],
      rejected_arguments: [],
      invalidation_conditions: [],
      warnings: [
        `All 10 agents errored. Sample error: ${sampleErr}`,
        "No entries, stop losses, or targets were produced because no real model analysis exists.",
        "Do NOT trade based on this session.",
      ],
      data_quality: "DATA_UNAVAILABLE",
      model_used: model.model_id,
      provider_used: model.provider,
      latency_ms: Date.now() - start,
    };
  }

  const agentDump = results.map(summary).join("\n");
  const debateDump = debate.map((d, i) =>
    `Turn ${i+1}: A${d.challenger_agent} challenges A${d.challenged_agent}
  CLAIM: ${d.claim}
  COUNTER: ${d.counterclaim}
  EVIDENCE: ${d.evidence}
  ASSESSMENT: ${d.assessment}
  WINNER: ${d.winner_side}`).join("\n---\n");
  const contraDump = contradictions.map((c, i) => `#${i+1} [${c.topic}] A${c.conflicting_claim_a.agent} says: "${c.conflicting_claim_a.claim}" | A${c.conflicting_claim_b.agent} says: "${c.conflicting_claim_b.claim}" (${c.status})`).join("\n");

  const system = `You are the CHIEF JUDGE — an independent senior trading analyst for position trading in gold/forex.
You receive: 10 independent specialist analyses, a structured debate, contradictions, and the frozen market/news/macro snapshot.
You do NOT simply count votes. You weigh EVIDENCE QUALITY, DATA FRESHNESS, TIMEFRAME ALIGNMENT, STRUCTURE, SMC, LIQUIDITY, PRICE ACTION, VOLUME, FVG/S-D, MOMENTUM, MACRO, NEWS, RISK/REWARD, DEBATE QUALITY, and INVALIDATION.

ABSOLUTE RULES:
- NEVER fabricate prices, entries, SL, TP, or confidence.
- If evidence is insufficient or risk/reward is poor or data quality is low, choose NO_TRADE.
- NO_TRADE is a FIRST-CLASS, expected outcome.
- Stop loss must be based on market structure where possible (swing invalidation, OB, S/R, FVG, liquidity).
- Targets must be based on liquidity/structure/FVG/S-D, not arbitrary percentages.
- If entry/SL/TP cannot be derived from real evidence, set to null.
- risk_reward must be null if entry, SL, or TP1 are null; otherwise compute as |TP1 - entry| / |entry - SL| from entry midpoint.
- confidence (0-100) reflects YOUR epistemic confidence in the decision, not a probability of profit.
- Never guarantee profit; never say "sure shot" or "100%".
- Acknowledge the user's risk amount but do NOT silently modify it. If risk exceeds conservative limits, emit a warning.

Return STRICT JSON (no prose outside):
{
  "final_decision": "BUY"|"SELL"|"NO_TRADE",
  "final_confidence": 0-100,
  "entry": { "low": number|null, "high": number|null },
  "stop_loss": number|null,
  "targets": { "tp1": number|null, "tp2": number|null, "tp3": number|null },
  "decision_summary": string,
  "strongest_bullish_arguments": string[],
  "strongest_bearish_arguments": string[],
  "rejected_arguments": string[],
  "invalidation_conditions": string[],
  "warnings": string[]
}`;

  const user = `=== SNAPSHOT CONTEXT ===
Session: ${snapshot.session_id}
Instrument: ${snapshot.instrument.assetClass} - ${snapshot.instrument.symbol}
User TF: ${snapshot.user_timeframe} | Detected TF: ${snapshot.detected_timeframe ?? "n/a"} | TF used: ${snapshot.timeframe_used} | mismatch: ${snapshot.timeframe_mismatch}
Snapshot time (UTC): ${snapshot.created_at}
Risk amount: ${snapshot.risk.riskAmount ?? "n/a"} | Balance: ${snapshot.risk.accountBalance ?? "n/a"} | Desired profit: ${snapshot.risk.desiredProfit ?? "n/a"}
Market data: ${snapshot.market.status} (${snapshot.market.source ?? "n/a"}) @ ${snapshot.market.fetchedAt ?? "n/a"} — ${snapshot.market.error ?? `${snapshot.market.candles?.length ?? 0} candles`}
News: ${snapshot.news.status} @ ${snapshot.news.fetchedAt ?? "n/a"} — ${snapshot.news.error ?? `${snapshot.news.items?.length ?? 0} items`}
Macro: ${snapshot.macro.status} @ ${snapshot.macro.fetchedAt ?? "n/a"} — ${snapshot.macro.error ?? `${snapshot.macro.series?.length ?? 0} series`}
Test mode: ${snapshot.test_mode}

=== ROUND 1 AGENTS ===
Vote distribution going into debate: BUY=${v.buy}, SELL=${v.sell}, NO_TRADE=${v.no_trade}
${agentDump}

=== DEBATE ===
${debateDump || "(no debate turns generated)"}

=== CONTRADICTIONS ===
${contraDump || "(no system-detected contradictions)"}

Now, produce your independent final verdict. Return only the JSON object.`;

  const llmStart = Date.now();
  const res = await callLLM(model, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], {
    temperature: 0.2,
    maxTokens: 3500,
    jsonMode: true,
    sessionId: snapshot.session_id,
    agentLabel: "chief-judge",
  });
  const latency = Date.now() - llmStart;

  let parsed: any = null;
  if (res.text) parsed = parseJsonFromLLM(res.text);
  const fallbackDecision: FinalDecision = {
    final_decision: "NO_TRADE",
    vote_distribution: v,
    final_confidence: 0,
    entry: { low: null, high: null },
    stop_loss: null,
    targets: { tp1: null, tp2: null, tp3: null },
    risk_amount: snapshot.risk.riskAmount ?? null,
    position_size: null,
    risk_reward: null,
    decision_summary: `Chief Judge could not parse a valid verdict. ${res.error ?? "The model returned empty or malformed output."}`,
    strongest_bullish_arguments: [],
    strongest_bearish_arguments: [],
    rejected_arguments: [],
    invalidation_conditions: [],
    warnings: [res.error ?? "Malformed response from Chief Judge model."],
    data_quality: pickDataQuality(results, snapshot),
    data_freshness: snapshot.market.fetchedAt,
    model_used: model.model_id,
    provider_used: model.provider,
    latency_ms: latency,
  };
  if (!parsed || typeof parsed !== "object") return fallbackDecision;

  const fd: Decision =
    parsed.final_decision === "BUY" || parsed.final_decision === "SELL" ? parsed.final_decision : "NO_TRADE";
  const entryLow = typeof parsed.entry?.low === "number" && isFinite(parsed.entry.low) ? parsed.entry.low : null;
  const entryHigh = typeof parsed.entry?.high === "number" && isFinite(parsed.entry.high) ? parsed.entry.high : null;
  const sl = typeof parsed.stop_loss === "number" && isFinite(parsed.stop_loss) ? parsed.stop_loss : null;
  const tp1 = typeof parsed.targets?.tp1 === "number" && isFinite(parsed.targets.tp1) ? parsed.targets.tp1 : null;
  const tp2 = typeof parsed.targets?.tp2 === "number" && isFinite(parsed.targets.tp2) ? parsed.targets.tp2 : null;
  const tp3 = typeof parsed.targets?.tp3 === "number" && isFinite(parsed.targets.tp3) ? parsed.targets.tp3 : null;

  let rr: number | null = null;
  if (entryLow != null && entryHigh != null && sl != null && tp1 != null) {
    const mid = (entryLow + entryHigh) / 2;
    const risk = Math.abs(mid - sl);
    const reward = Math.abs(tp1 - mid);
    if (risk > 0) rr = Number((reward / risk).toFixed(2));
  } else if (
    (entryLow != null || entryHigh != null) && sl != null && tp1 != null
  ) {
    const entry = entryLow ?? entryHigh as number;
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp1 - entry);
    if (risk > 0) rr = Number((reward / risk).toFixed(2));
  }

  const conf = typeof parsed.final_confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.final_confidence))) : 0;
  const riskAmount = snapshot.risk.riskAmount ?? null;
  const entryMid = entryLow != null && entryHigh != null ? (entryLow + entryHigh) / 2 : (entryLow ?? entryHigh);
  const positionSize = calcPositionSize(riskAmount, entryMid ?? null, sl);

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [];
  if (snapshot.timeframe_mismatch) {
    warnings.push(`Timeframe mismatch detected (user ${snapshot.user_timeframe} vs detected ${snapshot.detected_timeframe}). Analysis used ${snapshot.timeframe_used}.`);
  }
  if (snapshot.market.status !== "OK") {
    warnings.push(`Market data unavailable: ${snapshot.market.error ?? "reason unknown"}. Decision relies on chart/screenshot evidence only.`);
  }
  if (snapshot.news.status !== "OK") {
    warnings.push(`News unavailable: ${snapshot.news.error ?? "reason unknown"}.`);
  }
  if (snapshot.macro.status !== "OK") {
    warnings.push(`Macro data unavailable: ${snapshot.macro.error ?? "reason unknown"}.`);
  }
  if (riskAmount != null && snapshot.risk.accountBalance && riskAmount / snapshot.risk.accountBalance > 0.05) {
    warnings.push("Requested risk exceeds conservative 5% account-risk guideline.");
  }
  if (snapshot.test_mode) {
    warnings.push("TEST MODE is enabled — results may use mock data and MUST NOT be traded.");
  }
  if (positionSize == null && fd !== "NO_TRADE" && riskAmount != null) {
    warnings.push("Position size unavailable: instrument specification (lot/pip size) not configured; returned a simple risk-per-unit estimate instead if computable.");
  }

  return {
    final_decision: fd,
    vote_distribution: v,
    final_confidence: conf,
    entry: { low: entryLow, high: entryHigh },
    stop_loss: sl,
    targets: { tp1, tp2, tp3 },
    risk_amount: riskAmount,
    position_size: positionSize,
    risk_reward: rr ?? (typeof parsed.risk_reward === "number" && isFinite(parsed.risk_reward) ? parsed.risk_reward : null),
    decision_summary: String(parsed.decision_summary ?? "").slice(0, 2000),
    strongest_bullish_arguments: Array.isArray(parsed.strongest_bullish_arguments) ? parsed.strongest_bullish_arguments.map(String) : [],
    strongest_bearish_arguments: Array.isArray(parsed.strongest_bearish_arguments) ? parsed.strongest_bearish_arguments.map(String) : [],
    rejected_arguments: Array.isArray(parsed.rejected_arguments) ? parsed.rejected_arguments.map(String) : [],
    invalidation_conditions: Array.isArray(parsed.invalidation_conditions) ? parsed.invalidation_conditions.map(String) : [],
    warnings,
    data_quality: pickDataQuality(results, snapshot),
    data_freshness: snapshot.market.fetchedAt ?? snapshot.news.fetchedAt ?? snapshot.macro.fetchedAt,
    model_used: model.model_id,
    provider_used: model.provider,
    latency_ms: latency,
  };
}
