// services/judge.js — the independent 11th Chief Judge. Does NOT just count votes.
import { resolveRoute } from '../config.js';
import { chatCompletion, validateModel } from '../providers/llm.js';
import { ANTI_INJECTION } from './vision.js';
import { snapshotContext } from './agents.js';
import { clamp, toNumOrNull } from '../util.js';

const JUDGE_SCHEMA = `Return STRICT JSON only, exactly this schema:
{
  "final_decision": "BUY" | "SELL" | "NO_TRADE",
  "final_confidence": <0-100>,
  "entry": { "low": <number|null>, "high": <number|null> },
  "stop_loss": <number|null>,
  "targets": { "tp1": <number|null>, "tp2": <number|null>, "tp3": <number|null> },
  "risk_reward": <number|null>,
  "decision_summary": "<clear explanation of the decision>",
  "strongest_bullish_arguments": [],
  "strongest_bearish_arguments": [],
  "rejected_arguments": ["arguments you rejected and WHY"],
  "invalidation_conditions": [],
  "warnings": [],
  "data_quality": "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT",
  "why_not_opposite": "<why the opposite direction was rejected>",
  "timeframe_alignment": "<assessment of timeframe agreement/conflict>"
}`;

export async function runChiefJudge({ agents, debate, contradictions, votes, snapshot, sessionId }) {
  const models = resolveRoute('chief_judge');
  if (!models.length) return { status: 'failed', error: 'No model configured for routing slot "chief_judge".' };

  const sys = `You are the CHIEF JUDGE — the independent 11th AI of a trading-analysis council for
position trading in gold/forex. You did not participate in Round 1 or the debate.
${ANTI_INJECTION}

You must NOT simply count votes. Evaluate ALL of:
1 evidence quality, 2 data freshness, 3 timeframe alignment, 4 technical structure, 5 SMC,
6 liquidity, 7 price action, 8 volume reliability, 9 FVG/supply-demand, 10 momentum,
11 macro, 12 news, 13 risk/reward, 14 debate quality, 15 contradictions, 16 invalidation conditions.

HARD RULES:
- NO_TRADE is a first-class outcome and MUST be chosen when: data quality is insufficient,
  timeframes conflict without resolution, risk/reward is poor, structure is unclear, a
  high-impact event is imminent, or no clean structure-based entry exists.
- NEVER fabricate prices/levels. Entry/SL/TP may only come from actual snapshot prices or
  clearly readable chart levels cited by agents. If none exist → leave null and prefer NO_TRADE.
- Stop loss must be structure-based (swing/structure/liquidity/zone invalidation), never an
  arbitrary percentage. Targets must be based on liquidity/structure/zones/prior highs-lows
  with realistic risk/reward.
- final_confidence is analytical confidence, NOT probability of profit. Never guarantee outcomes.
- If critical market data is DATA_UNAVAILABLE, you must weight that heavily toward NO_TRADE
  and set data_quality accordingly.
${JUDGE_SCHEMA}`;

  const agentBlock = agents.map(a => a.result
    ? JSON.stringify(a.result)
    : JSON.stringify({ agent_number: a.agent_number, status: 'FAILED', error: a.error })).join('\n');

  const debateBlock = debate.entries.map(e => JSON.stringify({
    challenger: e.challenger_agent, challenged: e.challenged_agent, claim: e.claim,
    challenge: e.challenge, counterclaim: e.counterclaim, assessment: e.assessment, winner: e.winner,
  })).join('\n') || '(no debate exchanges available)';

  const ctrBlock = contradictions.map(c => JSON.stringify({ topic: c.topic, kind: c.kind, summary: c.detail.summary })).join('\n') || '(none detected)';

  const user = `${snapshotContext(snapshot)}

=== ROUND 1 — ALL 10 ORIGINAL AGENT ANALYSES (unmodified) ===
${agentBlock}

=== AGENT VOTE DISTRIBUTION (informational only — do NOT decide by counting) ===
BUY ${votes.buy} | SELL ${votes.sell} | NO_TRADE ${votes.no_trade} (of ${votes.total})

=== ROUND 2 — DEBATE TRANSCRIPT ===
${debateBlock}

=== CONTRADICTION ENGINE OUTPUT ===
${ctrBlock}

=== USER RISK CONTEXT ===
risk_amount: ${snapshot.risk_amount ?? 'not provided'}
account_balance: ${snapshot.account_balance ?? 'not provided'}
desired_profit: ${snapshot.desired_profit ?? 'not provided'}

Deliver your independent final judgment now. STRICT JSON only.`;

  const errors = [];
  for (const model of models) {
    const v = await validateModel(model);
    if (!v.valid) { errors.push(`${model.provider}/${model.model_id}: ${v.error}`); continue; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await chatCompletion(model, [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ], { expectJson: true, sessionId, agentLabel: 'chief_judge', maxTokens: 6144, temperature: 0.1 });
      if (res.ok && res.json) {
        const parsed = validateJudge(res.json);
        if (parsed) return { status: 'ok', provider: res.provider, model_id: res.model_id, latency_ms: res.latency_ms, result: parsed, test_data: !!res.test_data };
        errors.push(`${model.provider}/${model.model_id} attempt ${attempt}: judge JSON failed schema validation`);
      } else {
        errors.push(`${model.provider}/${model.model_id} attempt ${attempt}: ${res.error}`);
        break;
      }
    }
  }
  return { status: 'failed', error: errors.join(' | ') };
}

function validateJudge(j) {
  const dec = String(j.final_decision || j.decision || '').toUpperCase().replace(/\s+/g, '_');
  if (!['BUY', 'SELL', 'NO_TRADE'].includes(dec)) return null;
  const arr = k => Array.isArray(j[k]) ? j[k].map(x => String(typeof x === 'object' ? JSON.stringify(x) : x).slice(0, 600)).slice(0, 15) : [];
  const dq = String(j.data_quality || '').toUpperCase();
  return {
    final_decision: dec,
    final_confidence: clamp(Math.round(Number(j.final_confidence) || 0), 0, 100),
    entry: { low: toNumOrNull(j.entry?.low), high: toNumOrNull(j.entry?.high) },
    stop_loss: toNumOrNull(j.stop_loss),
    targets: { tp1: toNumOrNull(j.targets?.tp1), tp2: toNumOrNull(j.targets?.tp2), tp3: toNumOrNull(j.targets?.tp3) },
    risk_reward: toNumOrNull(j.risk_reward),
    decision_summary: String(j.decision_summary || '').slice(0, 4000),
    strongest_bullish_arguments: arr('strongest_bullish_arguments'),
    strongest_bearish_arguments: arr('strongest_bearish_arguments'),
    rejected_arguments: arr('rejected_arguments'),
    invalidation_conditions: arr('invalidation_conditions'),
    warnings: arr('warnings'),
    data_quality: ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'].includes(dq) ? dq : 'INSUFFICIENT',
    why_not_opposite: String(j.why_not_opposite || '').slice(0, 2000),
    timeframe_alignment: String(j.timeframe_alignment || '').slice(0, 1000),
  };
}
