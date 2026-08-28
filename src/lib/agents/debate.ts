// Round 2: Structured adversarial debate.
// Each debate turn references a concrete claim from another agent.
// We generate a small set of high-value challenges rather than fake filler.
import "server-only";
import { callLLM, parseJsonFromLLM } from "../llm";
import { buildEffectiveModels } from "../model-registry";
import type { AgentResult, AnalysisSnapshot, DebateTurn, Contradiction, Decision } from "../types";

function votes(results: AgentResult[]) {
  const v = { buy: 0, sell: 0, no_trade: 0 };
  for (const r of results) {
    if (r.decision === "BUY") v.buy++;
    else if (r.decision === "SELL") v.sell++;
    else v.no_trade++;
  }
  return v;
}

function compactAgentSummary(r: AgentResult): string {
  return `Agent ${r.agent_number} (${r.agent_name}) [model: ${r.provider_used}/${r.model_used}]
Decision: ${r.decision} | Confidence: ${r.confidence}
Evidence:
${r.evidence.slice(0, 6).map((e, i) => `  ${i+1}. ${e}`).join("\n")}
Supporting: ${r.supporting_factors.slice(0, 4).join("; ") || "(none)"}
Contradicting: ${r.contradicting_factors.slice(0, 4).join("; ") || "(none)"}
Entry zone: ${JSON.stringify(r.entry_zone)} | SL: ${r.stop_loss} | TP1: ${r.take_profit_1} | TP2: ${r.take_profit_2} | TP3: ${r.take_profit_3}
RR: ${r.risk_reward}
Data quality: ${r.data_quality}
Warnings: ${r.warnings.slice(0,4).join("; ") || "(none)"}
Invalidation: ${r.invalidation_conditions.slice(0,3).join("; ") || "(none)"}
`;
}

function detectStaticContradictions(results: AgentResult[]): Contradiction[] {
  const contradictions: Contradiction[] = [];
  const buyers = results.filter((r) => r.decision === "BUY");
  const sellers = results.filter((r) => r.decision === "SELL");
  // Topic: trend
  const trendRegex = /(bullish|bearish|uptrend|downtrend|trend)/i;
  const bullTrend = buyers.find((r) => r.evidence.some((e) => trendRegex.test(e)) || r.supporting_factors.some((e) => trendRegex.test(e)));
  const bearTrend = sellers.find((r) => r.evidence.some((e) => trendRegex.test(e)) || r.supporting_factors.some((e) => trendRegex.test(e)));
  if (bullTrend && bearTrend) {
    contradictions.push({
      topic: "Trend direction",
      conflicting_claim_a: { agent: bullTrend.agent_number, claim: "Trend interpreted as bullish / continuation setup." },
      conflicting_claim_b: { agent: bearTrend.agent_number, claim: "Trend interpreted as bearish / reversal setup." },
      status: "CONFLICTING",
    });
  }
  // Topic: liquidity
  const liqRegex = /(liquidity|sweep|stop.?hunt|equal high|equal low)/i;
  const bullLiq = buyers.find((r) => r.evidence.some((e) => liqRegex.test(e)));
  const bearLiq = sellers.find((r) => r.evidence.some((e) => liqRegex.test(e)));
  if (bullLiq && bearLiq) {
    contradictions.push({
      topic: "Liquidity interpretation",
      conflicting_claim_a: { agent: bullLiq.agent_number, claim: "Liquidity read supports bullish case (e.g. sell-side swept before continuation)." },
      conflicting_claim_b: { agent: bearLiq.agent_number, claim: "Liquidity read supports bearish case (e.g. buy-side swept for downside continuation)." },
      status: "CONFLICTING",
    });
  }
  // Topic: FVG/SD
  const fvgRegex = /(fvg|fair value|gap|supply zone|demand zone|imbalance)/i;
  const bullFvg = buyers.find((r) => r.evidence.some((e) => fvgRegex.test(e)));
  const bearFvg = sellers.find((r) => r.evidence.some((e) => fvgRegex.test(e)));
  if (bullFvg && bearFvg) {
    contradictions.push({
      topic: "FVG / Supply-Demand",
      conflicting_claim_a: { agent: bullFvg.agent_number, claim: "Bullish FVG/demand zone cited as support for BUY." },
      conflicting_claim_b: { agent: bearFvg.agent_number, claim: "Bearish FVG/supply zone cited as resistance for SELL." },
      status: "CONFLICTING",
    });
  }
  return contradictions;
}

/**
 * Generate debate turns. We ask the chosen model to produce structured
 * challenges: up to 3 buy-vs-sell challenges, each referencing specific evidence.
 */
export async function runDebate(
  snapshot: AnalysisSnapshot,
  results: AgentResult[],
  onProgress?: (msg: string, pct: number) => void
): Promise<{ turns: DebateTurn[]; contradictions: Contradiction[] }> {
  onProgress?.("Building adversarial debate...", 82);
  const models = buildEffectiveModels();
  const model = models.text.enabled ? models.text : (models.vision?.enabled ? models.vision : models.judge);
  const v = votes(results);

  const contradictions = detectStaticContradictions(results);

  if (!model) {
    return {
      turns: [],
      contradictions,
    };
  }

  const agentDump = results.map(compactAgentSummary).join("\n---\n");

  const system = `You are the Debate Moderator for a 10-agent trading-analysis council.
You must produce a STRUCTURED, ADVERSARIAL debate between agents on opposing sides.
Rules:
- Every challenge MUST reference a CONCRETE claim made by a specific agent (quote it or paraphrase precisely).
- Challenges should address the STRONGEST opposing argument, not a straw man.
- Distinguish CONFIRMED (visible in chart/data) vs POSSIBLE vs SPECULATIVE.
- If evidence is insufficient, the assessment must say "UNRESOLVED" rather than forcing a winner.
- Do not fabricate quotes; use only what appears in the agent summaries below.
- Return STRICT JSON of the form:
{
  "turns": [
    {
      "challenger_agent": number,
      "challenged_agent": number,
      "claim": "the exact claim being challenged (from challenged agent)",
      "counterclaim": "challenger's argument, citing evidence",
      "evidence": "specific chart/data evidence supporting or undermining the claim",
      "assessment": "independent assessment of who has the stronger evidence, or UNRESOLVED",
      "winner_side": "BUY"|"SELL"|"NO_TRADE"|"UNRESOLVED",
      "confidence_change": number   // -100 to +100 suggested adjustment to the overall confidence
    }
  ]
}
Produce between 2 and 5 turns. Prioritize the most important disagreements.
Do NOT include prose outside the JSON.
`;

  const user = `Vote distribution from Round 1: BUY=${v.buy}, SELL=${v.sell}, NO_TRADE=${v.no_trade}.

Agent summaries (Round 1):
${agentDump}

Initial contradictions detected by the system:
${JSON.stringify(contradictions, null, 2)}

Produce the debate now. JSON only.`;

  const start = Date.now();
  const res = await callLLM(model, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], { temperature: 0.2, maxTokens: 3000, jsonMode: true, sessionId: snapshot.session_id, agentLabel: "debate-moderator" });
  if (res.error || !res.text) {
    return { turns: [], contradictions };
  }
  const parsed = parseJsonFromLLM<{ turns?: any[] }>(res.text);
  const turns: DebateTurn[] = [];
  const idbase = `turn_${Date.now().toString(36)}_`;
  if (parsed && Array.isArray(parsed.turns)) {
    for (let i = 0; i < parsed.turns.length; i++) {
      const t = parsed.turns[i];
      const challenger = typeof t?.challenger_agent === "number" ? t.challenger_agent : 0;
      const challenged = typeof t?.challenged_agent === "number" ? t.challenged_agent : 0;
      if (!challenger || !challenged) continue;
      turns.push({
        id: idbase + i,
        challenger_agent: challenger,
        challenged_agent: challenged,
        claim: String(t?.claim ?? "").slice(0, 800),
        counterclaim: String(t?.counterclaim ?? "").slice(0, 1200),
        evidence: String(t?.evidence ?? "").slice(0, 1200),
        assessment: String(t?.assessment ?? "").slice(0, 1200),
        winner_side: (["BUY","SELL","NO_TRADE","UNRESOLVED"] as const).includes(t?.winner_side) ? t.winner_side : "UNRESOLVED",
        confidence_change: typeof t?.confidence_change === "number" ? Math.max(-100, Math.min(100, Math.round(t.confidence_change))) : 0,
        model_used: model.model_id,
        provider_used: model.provider,
      });
    }
  }
  // Mark latency
  (turns as any).__latency = Date.now() - start;
  return { turns, contradictions };
}
