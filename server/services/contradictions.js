// services/contradictions.js — deterministic contradiction detection across agent claims.
// Groups claims by topic; flags conflicts between opposing decisions. Does NOT force
// resolution when evidence is insufficient.
import { newId, nowIso } from '../util.js';

const TOPICS = [
  { key: 'trend', words: /trend|higher high|higher low|lower high|lower low|\bHH\b|\bHL\b|\bLH\b|\bLL\b|uptrend|downtrend|bullish structure|bearish structure/i },
  { key: 'bos_choch', words: /\bBOS\b|break of structure|\bCHoCH\b|change of character/i },
  { key: 'liquidity', words: /liquidit|sweep|stop.?hunt|equal high|equal low|\bEQH\b|\bEQL\b/i },
  { key: 'fvg_imbalance', words: /\bFVG\b|fair value gap|imbalance/i },
  { key: 'supply_demand', words: /supply zone|demand zone|order block|breaker/i },
  { key: 'momentum', words: /momentum|volatility|RSI|MACD|moving average/i },
  { key: 'volume', words: /volume|absorption/i },
  { key: 'macro', words: /fed|rate|inflation|CPI|PCE|yield|dollar|DXY|FOMC|macro/i },
  { key: 'news', words: /news|headline|sentiment|geopolit/i },
  { key: 'price_action', words: /candle|wick|engulf|pin bar|rejection|breakout/i },
];

function topicsOf(text) {
  return TOPICS.filter(t => t.words.test(text)).map(t => t.key);
}

/**
 * agents: rows with parsed result. Returns array of contradiction entries:
 * { topic, kind: CONFIRMED_FACT|CONFLICTING_CLAIM|UNRESOLVED_CLAIM, detail }
 */
export function detectContradictions(agents) {
  const claims = []; // {agent, decision, text, topics}
  for (const a of agents) {
    if (!a.result) continue;
    for (const e of [...(a.result.evidence || []), ...(a.result.supporting_factors || [])]) {
      const tps = topicsOf(e);
      if (tps.length) claims.push({ agent: a.result.agent_number, agent_name: a.result.agent_name, decision: a.result.decision, text: e, topics: tps });
    }
  }

  const out = [];
  for (const topic of TOPICS.map(t => t.key)) {
    const topicClaims = claims.filter(c => c.topics.includes(topic));
    if (!topicClaims.length) continue;
    const dirs = new Set(topicClaims.map(c => c.decision).filter(d => d !== 'NO_TRADE'));
    if (dirs.size > 1) {
      out.push({
        id: newId('ctr'), topic, kind: 'CONFLICTING_CLAIM', created_at: nowIso(),
        detail: {
          summary: `Agents cite "${topic}" evidence for OPPOSING directions.`,
          buy_claims: topicClaims.filter(c => c.decision === 'BUY').map(c => ({ agent: c.agent, agent_name: c.agent_name, claim: c.text })),
          sell_claims: topicClaims.filter(c => c.decision === 'SELL').map(c => ({ agent: c.agent, agent_name: c.agent_name, claim: c.text })),
          resolution: 'UNRESOLVED — requires debate/judge evaluation. Not forced.',
        },
      });
    } else if (topicClaims.length >= 2 && dirs.size === 1) {
      out.push({
        id: newId('ctr'), topic, kind: 'CONFIRMED_FACT', created_at: nowIso(),
        detail: {
          summary: `Multiple agents independently cite consistent "${topic}" evidence (${[...dirs][0] || 'NO_TRADE'}).`,
          claims: topicClaims.slice(0, 6).map(c => ({ agent: c.agent, agent_name: c.agent_name, claim: c.text })),
        },
      });
    } else {
      out.push({
        id: newId('ctr'), topic, kind: 'UNRESOLVED_CLAIM', created_at: nowIso(),
        detail: {
          summary: `Single-agent claim on "${topic}" — uncorroborated.`,
          claims: topicClaims.map(c => ({ agent: c.agent, agent_name: c.agent_name, claim: c.text })),
        },
      });
    }
  }
  return out;
}
