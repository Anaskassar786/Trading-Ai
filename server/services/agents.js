// services/agents.js — the 10 independent specialist agents (Round 1).
// Each agent makes a REAL model request against the same frozen snapshot,
// never sees other agents' conclusions in Round 1, and must return strict JSON.
import fs from 'node:fs';
import { resolveRoute } from '../config.js';
import { chatCompletion, validateModel } from '../providers/llm.js';
import { ANTI_INJECTION } from './vision.js';
import { clamp, toNumOrNull } from '../util.js';

export const AGENT_SPECS = [
  { n: 1, name: 'Technical Structure Agent', vision: true, focus: `Analyze market TREND and STRUCTURE only: higher highs (HH), higher lows (HL), lower highs (LH), lower lows (LL), break of structure (BOS), change of character (CHoCH), swing structure, key support, key resistance, trend continuation vs reversal possibility.` },
  { n: 2, name: 'Smart Money Concepts Agent', vision: true, focus: `Analyze SMC only: BOS, CHoCH, order blocks, breaker blocks, mitigation, displacement, inducement, institutional-style behavior, premium/discount arrays where applicable. NEVER claim an SMC concept exists unless the available evidence actually supports it — say so when it does not.` },
  { n: 3, name: 'Liquidity Agent', vision: true, focus: `Analyze LIQUIDITY only: buy-side liquidity, sell-side liquidity, equal highs, equal lows, previous highs/lows, liquidity sweeps, stop-hunt possibility, likely liquidity targets. For every liquidity claim you MUST label it CONFIRMED, POSSIBLE, or NOT PRESENT.` },
  { n: 4, name: 'Price Action Agent', vision: true, focus: `Analyze PRICE ACTION only: candle bodies, wicks, rejections, engulfing patterns, pin bars, momentum candles, consolidation, breakouts, false breakouts, price reactions at levels. Do NOT call every candle pattern a valid signal — assess strength honestly.` },
  { n: 5, name: 'Volume Agent', vision: true, focus: `Analyze VOLUME only, and ONLY if reliable volume data is available in the snapshot or visibly on the chart: expansion, contraction, confirmation, divergence, breakout volume, absorption. You MUST state whether the volume you used is REAL EXCHANGE VOLUME, TICK VOLUME, or UNAVAILABLE. FX/gold are OTC — never present tick volume as centralized exchange volume. If volume is unavailable, decision must be NO_TRADE with data_quality INSUFFICIENT and you must say "INSUFFICIENT DATA".` },
  { n: 6, name: 'FVG + Supply/Demand Agent', vision: true, focus: `Analyze IMBALANCES only: fair value gaps (FVG), imbalances, supply zones, demand zones, mitigation, rejection, zone strength, distance of zones from current price. Only identify zones supported by visible or data evidence.` },
  { n: 7, name: 'Trend + Momentum Agent', vision: true, focus: `Analyze TREND & MOMENTUM: multi-timeframe trend (only from data actually present), momentum, continuation vs reversal, trend strength, volatility. Moving averages / RSI / MACD may ONLY be referenced if actual values are computable from the candle data in the snapshot or visibly plotted on the chart — NEVER invent indicator values; say "INSUFFICIENT DATA" instead.` },
  { n: 8, name: 'Macro + Fundamental Agent', vision: false, focus: `Analyze MACRO only, using ONLY the FRED macro snapshot and news snapshot provided: interest rates, inflation (CPI/PCE), central banks, USD strength, Treasury yields, employment, FOMC/monetary policy, geopolitical macro drivers. Every macro claim must reference the data source and its date from the snapshot. If macro data is DATA_UNAVAILABLE you must not invent values — reflect that in data_quality.` },
  { n: 9, name: 'News + Sentiment Agent', vision: false, focus: `Analyze NEWS & SENTIMENT using ONLY the articles in the news snapshot: bullish vs bearish items, high-impact events, geopolitical events, central-bank events, USD/instrument-specific news. NEVER infer a headline the API did not return. For each important item cite: headline, source, published time, relevance, sentiment, potential impact. If the news snapshot is DATA_UNAVAILABLE, say so and lower data_quality.` },
  { n: 10, name: 'Position Trading + Risk Agent', vision: true, focus: `Analyze POSITION-TRADE SUITABILITY & RISK: entry quality, structure-based stop placement, invalidation, target quality, risk/reward, volatility, distance to targets, and whether NO_TRADE is safer. Stops/targets must be based on market structure (swing invalidation, liquidity, supply/demand, FVG, prior highs/lows) — never arbitrary percentages. Use the user's risk amount when given; do NOT require account balance for chart-based SL/TP.` },
];

const SCHEMA_TEXT = `Return STRICT JSON ONLY (no prose outside JSON), exactly this schema:
{
  "agent_number": <int>,
  "agent_name": "<string>",
  "decision": "BUY" | "SELL" | "NO_TRADE",
  "confidence": <0-100 integer>,
  "evidence": ["specific factual observations that support your reasoning"],
  "supporting_factors": [],
  "contradicting_factors": [],
  "entry_zone": { "low": <number|null>, "high": <number|null> },
  "stop_loss": <number|null>,
  "take_profit_1": <number|null>,
  "take_profit_2": <number|null>,
  "take_profit_3": <number|null>,
  "risk_reward": <number|null>,
  "invalidation_conditions": ["conditions that invalidate your view"],
  "data_quality": "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT",
  "warnings": []
}
Rules:
- NO_TRADE is a first-class, often correct answer. Prefer NO_TRADE over a forced call.
- If the data you specialize in is missing, decision=NO_TRADE, data_quality=INSUFFICIENT, and say "INSUFFICIENT DATA" in evidence.
- Price levels (entry/SL/TP) may ONLY come from actual snapshot prices or clearly readable chart levels. If neither exists, leave them null.
- Confidence is YOUR analytical confidence, not a probability of profit.
- Never guarantee outcomes.`;

/** Serialize the frozen snapshot into an honest textual context for a prompt. */
export function snapshotContext(snapshot, { includeCandles = true } = {}) {
  const L = [];
  L.push(`=== IMMUTABLE ANALYSIS SNAPSHOT (frozen at ${snapshot.frozen_at}) ===`);
  L.push(`Session: ${snapshot.session_id}`);
  L.push(`Symbol: ${snapshot.symbol} (${snapshot.instrument_type || 'unknown type'})`);
  L.push(`User-selected timeframe: ${snapshot.user_timeframe || 'not provided'}`);
  L.push(`Detected timeframe (from screenshot): ${snapshot.detected_timeframe || 'NOT DETECTED'}`);
  L.push(`Timeframe used for analysis: ${snapshot.timeframe_used}`);
  if (snapshot.timeframe_mismatch) L.push(`!! TIMEFRAME MISMATCH between user selection and screenshot. Analysis uses the DETECTED timeframe.`);
  L.push(`User risk amount: ${snapshot.risk_amount ?? 'not provided'}`);
  L.push(`Account balance: ${snapshot.account_balance ?? 'not provided'}`);
  L.push(`Desired profit: ${snapshot.desired_profit ?? 'not provided'}`);

  L.push(`\n--- SCREENSHOT INSPECTION (by vision model) ---`);
  if (snapshot.vision?.status === 'OK') {
    const d = snapshot.vision.detection;
    L.push(JSON.stringify(d, null, 1));
  } else {
    L.push(`IMAGE_ANALYSIS_UNAVAILABLE: ${snapshot.vision?.reason || 'no vision model configured'}`);
  }

  L.push(`\n--- MARKET DATA (Twelve Data) ---`);
  const md = snapshot.market_data;
  if (md?.status === 'OK') {
    L.push(`Source: ${md.source} | fetched_at: ${md.fetched_at} | interval: ${md.interval}`);
    L.push(`Latest candle: ${JSON.stringify(md.latest)}`);
    L.push(`Volume type: ${md.volume_type} — ${md.volume_note}`);
    if (includeCandles) {
      const cs = md.candles.slice(-80);
      L.push(`Last ${cs.length} candles (oldest→newest) as [datetime,O,H,L,C,V]:`);
      L.push(cs.map(c => `[${c.datetime},${c.open},${c.high},${c.low},${c.close},${c.volume ?? 'null'}]`).join('\n'));
    }
  } else {
    L.push(`DATA_UNAVAILABLE — provider: ${md?.provider}, reason: ${md?.reason}. Do NOT invent prices. Anything requiring live price data is INSUFFICIENT DATA.`);
  }

  const htf = snapshot.market_data_higher;
  L.push(`\n--- HIGHER-TIMEFRAME DATA (${snapshot.higher_timeframe || 'n/a'}) ---`);
  if (htf?.status === 'OK') {
    const cs = htf.candles.slice(-40);
    L.push(`Source: ${htf.source} | fetched_at: ${htf.fetched_at}`);
    L.push(cs.map(c => `[${c.datetime},${c.open},${c.high},${c.low},${c.close}]`).join('\n'));
  } else {
    L.push(`MISSING DATA: ${htf?.reason || 'not fetched'}. Do not fabricate higher-timeframe context beyond what is actually present.`);
  }

  L.push(`\n--- NEWS SNAPSHOT ---`);
  const nw = snapshot.news;
  if (nw?.status === 'OK') {
    L.push(`Source: ${nw.source} | fetched_at: ${nw.fetched_at} | terms: ${nw.query_terms.join(', ')}`);
    for (const a of nw.articles.slice(0, 20)) L.push(`- [${a.published_at}] (${a.source}) ${a.headline}${a.description ? ` — ${a.description}` : ''}`);
    if (!nw.articles.length) L.push('(zero articles returned)');
  } else {
    L.push(`DATA_UNAVAILABLE — reason: ${nw?.reason}. NEVER invent headlines.`);
  }

  L.push(`\n--- MACRO SNAPSHOT (FRED) ---`);
  const mc = snapshot.macro;
  if (mc?.status === 'OK' || mc?.status === 'PARTIAL') {
    L.push(`Source: ${mc.source} | fetched_at: ${mc.fetched_at} | ${mc.note}`);
    for (const s of mc.series) {
      if (s.status === 'OK') L.push(`- ${s.label} [${s.series_id}]: latest ${s.latest.value} (${s.latest.date})${s.previous ? `, prev ${s.previous.value} (${s.previous.date})` : ''}${s.year_ago ? `, year-ago ${s.year_ago.value} (${s.year_ago.date})` : ''}`);
      else L.push(`- ${s.label} [${s.series_id}]: DATA_UNAVAILABLE (${s.reason})`);
    }
  } else {
    L.push(`DATA_UNAVAILABLE — reason: ${mc?.reason}. NEVER invent macro values.`);
  }

  L.push(`\nAVAILABLE DATA: ${snapshot.data_status.available.join(', ') || 'none'}`);
  L.push(`MISSING DATA: ${snapshot.data_status.missing.join(', ') || 'none'}`);
  L.push(`=== END SNAPSHOT ===`);
  return L.join('\n');
}

export function validateAgentResult(json, spec) {
  const errors = [];
  const out = {
    agent_number: spec.n,
    agent_name: spec.name,
    decision: null, confidence: 0,
    evidence: [], supporting_factors: [], contradicting_factors: [],
    entry_zone: { low: null, high: null },
    stop_loss: null, take_profit_1: null, take_profit_2: null, take_profit_3: null,
    risk_reward: null, invalidation_conditions: [], data_quality: 'INSUFFICIENT', warnings: [],
  };
  if (!json || typeof json !== 'object') return { ok: false, errors: ['no JSON object'], result: null };
  const dec = String(json.decision || '').toUpperCase().replace(/\s+/g, '_');
  if (!['BUY', 'SELL', 'NO_TRADE'].includes(dec)) errors.push(`invalid decision "${json.decision}"`);
  else out.decision = dec;
  out.confidence = clamp(Math.round(Number(json.confidence) || 0), 0, 100);
  for (const k of ['evidence', 'supporting_factors', 'contradicting_factors', 'invalidation_conditions', 'warnings']) {
    if (Array.isArray(json[k])) out[k] = json[k].map(x => String(typeof x === 'object' ? JSON.stringify(x) : x).slice(0, 600)).slice(0, 15);
  }
  if (json.entry_zone && typeof json.entry_zone === 'object') {
    out.entry_zone.low = toNumOrNull(json.entry_zone.low);
    out.entry_zone.high = toNumOrNull(json.entry_zone.high);
  }
  for (const k of ['stop_loss', 'take_profit_1', 'take_profit_2', 'take_profit_3', 'risk_reward']) out[k] = toNumOrNull(json[k]);
  const dq = String(json.data_quality || '').toUpperCase();
  out.data_quality = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'].includes(dq) ? dq : 'INSUFFICIENT';
  if (errors.length) return { ok: false, errors, result: null };
  return { ok: true, errors: [], result: out };
}

/**
 * Run one agent (Round 1). Independent: sees ONLY the frozen snapshot.
 * Returns { status:'ok'|'failed', provider, model_id, latency_ms, result?, error? }
 */
export async function runAgent(spec, snapshot, imageFile, sessionId) {
  const models = resolveRoute(`agent_${spec.n}`);
  if (!models.length) return { status: 'failed', error: `No enabled/configured model for routing slot agent_${spec.n}. Configure it in Settings.` };

  const context = snapshotContext(snapshot);
  const sys = `You are ${spec.name} (Agent ${spec.n} of 10) on a private trading-analysis council for position trading in gold and forex.
${ANTI_INJECTION}

YOUR SPECIALIZATION:
${spec.focus}

ABSOLUTE NO-FAKE-DATA RULE: never fabricate prices, candles, volume, news, macro values,
indicator values, or API data. If something you need is missing from the snapshot, say
"INSUFFICIENT DATA" and reduce data_quality. You are analyzing an immutable frozen snapshot.
You are NOT told what any other agent concluded — analyze independently.

${SCHEMA_TEXT}`;

  const errors = [];
  for (const model of models) {
    const v = await validateModel(model);
    if (!v.valid) { errors.push(`${model.provider}/${model.model_id}: ${v.error || 'model invalid'}`); continue; }

    const userContent = [];
    userContent.push({ type: 'text', text: `${context}\n\nProduce your Agent ${spec.n} analysis now. STRICT JSON only.` });
    let sentImage = false;
    if (spec.vision && model.supports_image && imageFile?.path && fs.existsSync(imageFile.path)) {
      userContent.push({ type: 'image', mime: imageFile.mime, dataBase64: fs.readFileSync(imageFile.path).toString('base64') });
      sentImage = true;
    }

    // Up to 2 attempts for schema-valid JSON (bounded retry, never infinite).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await chatCompletion(model, [
        { role: 'system', content: sys },
        { role: 'user', content: sentImage ? userContent : userContent[0].text },
      ], { expectJson: true, sessionId, agentLabel: `agent_${spec.n}`, maxTokens: 4096 });
      if (res.ok && res.json) {
        const val = validateAgentResult(res.json, spec);
        if (val.ok) {
          if (spec.vision && !sentImage) {
            val.result.warnings.push('Chart image was NOT provided to this agent (model is not vision-capable); analysis relied on the vision-model inspection text and market data in the snapshot.');
          }
          if (res.test_data) val.result.warnings.unshift('TEST DATA — generated in TEST_MODE, not a real analysis.');
          return { status: 'ok', provider: res.provider, model_id: res.model_id, latency_ms: res.latency_ms, used_image: sentImage, result: val.result, test_data: !!res.test_data };
        }
        errors.push(`${model.provider}/${model.model_id} attempt ${attempt}: schema errors: ${val.errors.join('; ')}`);
      } else {
        errors.push(`${model.provider}/${model.model_id} attempt ${attempt}: ${res.error}`);
        break; // provider-level failure → go to fallback model
      }
    }
  }
  return { status: 'failed', error: errors.join(' | ') || 'no usable model' };
}
