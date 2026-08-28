// services/debate.js — Round 2 adversarial debate. Real model calls only.
// Every challenge references a concrete claim from a real Round-1 agent output.
import { resolveRoute } from '../config.js';
import { chatCompletion, validateModel } from '../providers/llm.js';
import { ANTI_INJECTION, } from './vision.js';
import { snapshotContext } from './agents.js';
import { clamp } from '../util.js';

export function voteDistribution(agents) {
  const votes = { buy: 0, sell: 0, no_trade: 0 };
  for (const a of agents) {
    if (!a.result) continue;
    if (a.result.decision === 'BUY') votes.buy++;
    else if (a.result.decision === 'SELL') votes.sell++;
    else votes.no_trade++;
  }
  const total = votes.buy + votes.sell + votes.no_trade;
  return {
    ...votes,
    total,
    pct: total ? { buy: Math.round(votes.buy / total * 100), sell: Math.round(votes.sell / total * 100), no_trade: Math.round(votes.no_trade / total * 100) } : { buy: 0, sell: 0, no_trade: 0 },
    note: 'Agent vote distribution — NOT a probability of profit.',
  };
}

function strongest(agents, decision) {
  return agents.filter(a => a.result?.decision === decision).sort((x, y) => y.result.confidence - x.result.confidence);
}

const DEBATE_SCHEMA = `Return STRICT JSON only:
{
  "challenge": "the specific question/attack, quoting or referencing the exact claim being challenged",
  "counterclaim": "the challenged agent's substantive defense or concession, grounded ONLY in snapshot evidence",
  "evidence": ["concrete snapshot/chart facts used by either side"],
  "assessment": "which side's argument is stronger and WHY, or 'UNRESOLVED — insufficient evidence'",
  "winner": "CHALLENGER" | "CHALLENGED" | "UNRESOLVED",
  "confidence_change": { "challenger_delta": <int -30..30>, "challenged_delta": <int -30..30> }
}`;

/**
 * Build up to `maxExchanges` real adversarial exchanges between opposing agents.
 * Each exchange = one model call that must ground itself in the two agents' actual JSON.
 */
export async function runDebate(agents, snapshot, sessionId, maxExchanges = 4) {
  const models = resolveRoute('debate');
  if (!models.length) return { status: 'failed', entries: [], error: 'No model configured for routing slot "debate".' };

  const buy = strongest(agents, 'BUY');
  const sell = strongest(agents, 'SELL');
  const noTrade = strongest(agents, 'NO_TRADE');

  // Pair opposing sides: strongest BUY vs strongest SELL, then cross-checks vs NO_TRADE.
  const pairs = [];
  const push = (c, d) => { if (c && d && pairs.length < maxExchanges) pairs.push([c, d]); };
  push(buy[0], sell[0]);
  push(sell[0], buy[0]);
  push(buy[1] || buy[0], sell[1] || sell[0]);
  if (noTrade[0]) { push(noTrade[0], buy[0] || sell[0]); }
  if (!pairs.length && (buy[0] || sell[0] || noTrade[0])) {
    // Unanimous council: stress-test the strongest view with the strongest dissent-by-confidence.
    const all = agents.filter(a => a.result).sort((x, y) => y.result.confidence - x.result.confidence);
    if (all.length >= 2) pairs.push([all[all.length - 1], all[0]]);
  }
  // De-duplicate identical pairs.
  const seen = new Set();
  const uniquePairs = pairs.filter(([c, d]) => {
    if (c.result.agent_number === d.result.agent_number) return false;
    const k = `${c.result.agent_number}-${d.result.agent_number}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const ctx = snapshotContext(snapshot, { includeCandles: false });
  const entries = [];
  const errors = [];
  let seq = 0;

  for (const [challenger, challenged] of uniquePairs) {
    seq++;
    const sys = `You are the structured-debate moderator of a trading-analysis council.
${ANTI_INJECTION}
Two REAL agent analyses are given below. Simulate ONE rigorous adversarial exchange:
the CHALLENGER (${challenger.result.agent_name}, voted ${challenger.result.decision}) must attack the single STRONGEST
concrete claim in the CHALLENGED agent's analysis (${challenged.result.agent_name}, voted ${challenged.result.decision});
the challenged agent must respond with its best defense using ONLY evidence present in its analysis or the snapshot.
Rules:
- The challenge MUST reference a concrete claim (quote it). "I disagree" is invalid.
- Identify evidence, assumptions, contradictions, invalidation, missing information.
- If evidence is insufficient to decide, the winner is UNRESOLVED. Do not force a resolution.
- NEVER introduce facts that are not in the snapshot or the two analyses.
${DEBATE_SCHEMA}`;

    const user = `${ctx}

CHALLENGER (Agent ${challenger.result.agent_number} — ${challenger.result.agent_name}) FULL ANALYSIS:
${JSON.stringify(challenger.result, null, 1)}

CHALLENGED (Agent ${challenged.result.agent_number} — ${challenged.result.agent_name}) FULL ANALYSIS:
${JSON.stringify(challenged.result, null, 1)}

Produce the debate exchange JSON now.`;

    let done = false;
    for (const model of models) {
      const v = await validateModel(model);
      if (!v.valid) { errors.push(`${model.provider}/${model.model_id}: ${v.error}`); continue; }
      const res = await chatCompletion(model, [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ], { expectJson: true, sessionId, agentLabel: `debate_${seq}`, maxTokens: 3072 });
      if (res.ok && res.json && res.json.challenge && res.json.counterclaim) {
        const cc = res.json.confidence_change || {};
        entries.push({
          seq,
          challenger_agent: challenger.result.agent_number,
          challenged_agent: challenged.result.agent_number,
          claim: firstClaim(challenged.result),
          challenge: String(res.json.challenge).slice(0, 2000),
          counterclaim: String(res.json.counterclaim).slice(0, 2000),
          evidence: Array.isArray(res.json.evidence) ? res.json.evidence.map(String).slice(0, 10) : [],
          assessment: String(res.json.assessment || 'UNRESOLVED').slice(0, 1500),
          winner: ['CHALLENGER', 'CHALLENGED', 'UNRESOLVED'].includes(res.json.winner) ? res.json.winner : 'UNRESOLVED',
          confidence_change: {
            challenger_delta: clamp(Math.round(Number(cc.challenger_delta) || 0), -30, 30),
            challenged_delta: clamp(Math.round(Number(cc.challenged_delta) || 0), -30, 30),
          },
          provider: res.provider, model_id: res.model_id, status: 'ok', test_data: !!res.test_data,
        });
        done = true;
        break;
      }
      errors.push(`${model.provider}/${model.model_id}: ${res.error || 'invalid debate JSON'}`);
    }
    if (!done) {
      entries.push({
        seq, challenger_agent: challenger.result.agent_number, challenged_agent: challenged.result.agent_number,
        claim: firstClaim(challenged.result), challenge: null, counterclaim: null, evidence: [],
        assessment: `DEBATE_UNAVAILABLE: ${errors.slice(-1)[0] || 'model failure'}`, winner: 'UNRESOLVED',
        confidence_change: { challenger_delta: 0, challenged_delta: 0 }, provider: null, model_id: null, status: 'failed',
      });
    }
  }

  return { status: entries.some(e => e.status === 'ok') ? 'ok' : (uniquePairs.length ? 'failed' : 'skipped'), entries, errors };
}

function firstClaim(result) {
  return (result.evidence?.[0] || result.supporting_factors?.[0] || `${result.decision} @ confidence ${result.confidence}`).slice(0, 500);
}
