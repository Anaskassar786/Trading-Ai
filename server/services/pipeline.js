// services/pipeline.js — orchestrates one immutable analysis session:
// freeze snapshot → Round 1 (10 independent agents) → votes → contradictions →
// Round 2 debate → Round 3 Chief Judge → trade plan. All progress is REAL execution state.
import path from 'node:path';
import db, { audit } from '../db.js';
import { newId, nowIso, sha256 } from '../util.js';
import { UPLOAD_DIR, isTestMode } from '../config.js';
import { fetchTimeSeries } from '../providers/marketdata.js';
import { fetchNewsSnapshot } from '../providers/news.js';
import { fetchMacroSnapshot } from '../providers/fred.js';
import { detectFromScreenshot } from './vision.js';
import { AGENT_SPECS, runAgent } from './agents.js';
import { voteDistribution, runDebate } from './debate.js';
import { detectContradictions } from './contradictions.js';
import { runChiefJudge } from './judge.js';
import { buildTradePlan } from './tradeplan.js';

const HIGHER_TF = { '1M': '15M', '5M': '30M', '15M': '1H', '30M': '4H', '1H': '4H', '4H': '1D', '1D': '1W', '1W': null };

// In-memory cache of vision detections per uploaded file (avoids double vision spend
// between precheck and analyze). Keyed by screenshot hash.
export const detectionCache = new Map();

function setProgress(sessionId, steps) {
  db.prepare('UPDATE analysis_sessions SET progress_json=? WHERE id=?').run(JSON.stringify(steps), sessionId);
}

function step(steps, sessionId, label) {
  const s = { label, status: 'running', started_at: nowIso(), finished_at: null, detail: null };
  steps.push(s);
  setProgress(sessionId, steps);
  return {
    done(detail = null) { s.status = 'done'; s.finished_at = nowIso(); s.detail = detail; setProgress(sessionId, steps); },
    fail(detail) { s.status = 'failed'; s.finished_at = nowIso(); s.detail = detail; setProgress(sessionId, steps); },
    warn(detail) { s.status = 'warning'; s.finished_at = nowIso(); s.detail = detail; setProgress(sessionId, steps); },
  };
}

/**
 * Create a NEW analysis session (every Analyze press = new session id) and run it async.
 */
export function createAndRunSession(input) {
  const sessionId = newId('as');
  db.prepare(`INSERT INTO analysis_sessions (id, created_at, status, test_mode, symbol, instrument_type, user_timeframe,
      screenshot_path, screenshot_hash, screenshot_mime, risk_amount, account_balance, desired_profit, progress_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sessionId, nowIso(), 'running', isTestMode() ? 1 : 0, input.symbol, input.instrumentType, input.userTimeframe,
      input.screenshotPath, input.screenshotHash, input.screenshotMime, input.riskAmount, input.accountBalance, input.desiredProfit, '[]');

  runSession(sessionId, input).catch(e => {
    console.error('pipeline crash', e);
    db.prepare('UPDATE analysis_sessions SET status=?, error=? WHERE id=?').run('failed', String(e.message).slice(0, 500), sessionId);
  });
  return sessionId;
}

async function runSession(sessionId, input) {
  const steps = [];
  const imageFile = { path: input.screenshotPath, mime: input.screenshotMime };

  // 1. Screenshot prep
  let st = step(steps, sessionId, 'Preparing screenshot');
  st.done(`hash ${input.screenshotHash.slice(0, 16)}…`);

  // 2. Timeframe/symbol detection
  st = step(steps, sessionId, 'Detecting symbol & timeframe from screenshot');
  let vision = detectionCache.get(input.screenshotHash) || null;
  if (!vision) {
    vision = await detectFromScreenshot(input.screenshotPath, input.screenshotMime, sessionId);
    if (vision.status === 'OK') detectionCache.set(input.screenshotHash, vision);
  }
  const detectedTf = vision.status === 'OK' ? vision.detection.timeframe_detected : null;
  const detectedSym = vision.status === 'OK' ? vision.detection.symbol_detected : null;
  const mismatch = !!(detectedTf && input.userTimeframe && detectedTf !== input.userTimeframe);
  const timeframeUsed = mismatch ? detectedTf : (detectedTf || input.userTimeframe);
  if (vision.status === 'OK') st.done(`detected: ${detectedSym || 'symbol not visible'} / ${detectedTf || 'timeframe not visible'}${mismatch ? ` — MISMATCH with user-selected ${input.userTimeframe}; using DETECTED ${detectedTf}` : ''}`);
  else st.warn(`IMAGE_ANALYSIS_UNAVAILABLE: ${vision.reason}. Falling back to user-selected timeframe ${input.userTimeframe}.`);

  db.prepare('UPDATE analysis_sessions SET detected_timeframe=?, detected_symbol=?, timeframe_mismatch=?, timeframe_used=? WHERE id=?')
    .run(detectedTf, detectedSym, mismatch ? 1 : 0, timeframeUsed, sessionId);

  // 3. Market data (primary + higher timeframe)
  st = step(steps, sessionId, `Fetching market data (${input.symbol} ${timeframeUsed})`);
  const marketData = await fetchTimeSeries(input.symbol, timeframeUsed, 120, sessionId);
  marketData.status === 'OK' ? st.done(`${marketData.candles.length} candles, latest ${marketData.latest.datetime}`) : st.warn(`DATA_UNAVAILABLE: ${marketData.reason}`);

  const higherTf = HIGHER_TF[timeframeUsed] || null;
  let marketDataHigher = { status: 'DATA_UNAVAILABLE', reason: 'No higher timeframe applicable' };
  if (higherTf) {
    st = step(steps, sessionId, `Fetching higher-timeframe data (${higherTf})`);
    marketDataHigher = await fetchTimeSeries(input.symbol, higherTf, 80, sessionId);
    marketDataHigher.status === 'OK' ? st.done(`${marketDataHigher.candles.length} candles`) : st.warn(`DATA_UNAVAILABLE: ${marketDataHigher.reason}`);
  }

  // 4. News
  st = step(steps, sessionId, 'Fetching news');
  const news = await fetchNewsSnapshot(input.symbol, input.instrumentType, sessionId);
  news.status === 'OK' ? st.done(`${news.articles.length} articles`) : st.warn(`DATA_UNAVAILABLE: ${news.reason}`);

  // 5. Macro
  st = step(steps, sessionId, 'Fetching macro data (FRED)');
  const macro = await fetchMacroSnapshot(sessionId);
  macro.status !== 'DATA_UNAVAILABLE' ? st.done(`${macro.series.filter(s => s.status === 'OK').length}/${macro.series.length} series`) : st.warn(`DATA_UNAVAILABLE: ${macro.reason}`);

  // 6. FREEZE the immutable snapshot. All agents read exactly this.
  st = step(steps, sessionId, 'Freezing immutable analysis snapshot');
  const available = [], missing = [];
  (vision.status === 'OK' ? available : missing).push('screenshot inspection');
  (marketData.status === 'OK' ? available : missing).push(`market data ${timeframeUsed}`);
  (marketDataHigher.status === 'OK' ? available : missing).push(`higher-timeframe data ${higherTf || ''}`.trim());
  (news.status === 'OK' ? available : missing).push('news');
  (macro.status === 'OK' || macro.status === 'PARTIAL' ? available : missing).push('macro (FRED)');

  const snapshot = {
    session_id: sessionId,
    frozen_at: nowIso(),
    test_mode: isTestMode(),
    symbol: input.symbol,
    instrument_type: input.instrumentType,
    user_timeframe: input.userTimeframe,
    detected_timeframe: detectedTf,
    detected_symbol: detectedSym,
    timeframe_mismatch: mismatch,
    timeframe_used: timeframeUsed,
    higher_timeframe: higherTf,
    screenshot_hash: input.screenshotHash,
    risk_amount: input.riskAmount,
    account_balance: input.accountBalance,
    desired_profit: input.desiredProfit,
    vision,
    market_data: marketData,
    market_data_higher: marketDataHigher,
    news,
    macro,
    data_status: { available, missing },
  };
  db.prepare('UPDATE analysis_sessions SET snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot), sessionId);
  st.done(`frozen at ${snapshot.frozen_at}; available: [${available.join(', ')}]; missing: [${missing.join(', ') || 'none'}]`);

  // 7. Round 1 — 10 independent agents against the SAME frozen snapshot.
  const agentRows = [];
  for (const spec of AGENT_SPECS) {
    st = step(steps, sessionId, `Running Agent ${spec.n}/10 — ${spec.name}`);
    const r = await runAgent(spec, snapshot, imageFile, sessionId);
    const row = {
      id: newId('ag'), session_id: sessionId, created_at: nowIso(),
      agent_number: spec.n, agent_name: spec.name,
      provider: r.provider || null, model_id: r.model_id || null,
      status: r.status, latency_ms: r.latency_ms || null,
      result_json: r.result ? JSON.stringify(r.result) : null, error: r.error || null,
    };
    db.prepare(`INSERT INTO agent_analyses (id,session_id,created_at,agent_number,agent_name,provider,model_id,status,latency_ms,result_json,error)
                VALUES (@id,@session_id,@created_at,@agent_number,@agent_name,@provider,@model_id,@status,@latency_ms,@result_json,@error)`).run(row);
    agentRows.push({ ...row, result: r.result || null });
    r.status === 'ok' ? st.done(`${r.result.decision} (confidence ${r.result.confidence}) via ${r.provider}/${r.model_id}`) : st.fail(r.error);
  }

  const okAgents = agentRows.filter(a => a.result);
  if (okAgents.length === 0) {
    // ALL providers failed → ANALYSIS_UNAVAILABLE. Never fabricate an answer.
    st = step(steps, sessionId, 'Finalizing');
    st.fail('ANALYSIS_UNAVAILABLE: all 10 agent model calls failed. No fabricated output will be produced.');
    db.prepare(`INSERT INTO final_decisions (id,session_id,created_at,status,decision,error) VALUES (?,?,?,?,?,?)`)
      .run(newId('fd'), sessionId, nowIso(), 'unavailable', 'ANALYSIS_UNAVAILABLE', 'All agent LLM calls failed. See agent errors and API Health.');
    db.prepare('UPDATE analysis_sessions SET status=? WHERE id=?').run('failed', sessionId);
    return;
  }

  // 8. Votes
  st = step(steps, sessionId, 'Calculating agent vote distribution');
  const votes = voteDistribution(agentRows);
  st.done(`BUY ${votes.buy} / SELL ${votes.sell} / NO_TRADE ${votes.no_trade} (of ${votes.total} completed agents)`);

  // 9. Contradiction engine
  st = step(steps, sessionId, 'Detecting contradictions');
  const contradictions = detectContradictions(agentRows);
  const insCtr = db.prepare('INSERT INTO contradictions (id,session_id,created_at,topic,kind,detail_json) VALUES (?,?,?,?,?,?)');
  for (const c of contradictions) insCtr.run(c.id, sessionId, c.created_at, c.topic, c.kind, JSON.stringify(c.detail));
  st.done(`${contradictions.filter(c => c.kind === 'CONFLICTING_CLAIM').length} conflicts, ${contradictions.filter(c => c.kind === 'CONFIRMED_FACT').length} corroborated facts`);

  // 10. Round 2 — adversarial debate
  st = step(steps, sessionId, 'Building adversarial debate');
  const debate = await runDebate(okAgents, snapshot, sessionId);
  const insDeb = db.prepare(`INSERT INTO agent_debates (id,session_id,created_at,seq,challenger_agent,challenged_agent,claim,challenge,counterclaim,evidence_json,assessment,winner,confidence_change_json,provider,model_id,status)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const e of debate.entries) {
    insDeb.run(newId('db'), sessionId, nowIso(), e.seq, e.challenger_agent, e.challenged_agent, e.claim, e.challenge, e.counterclaim,
      JSON.stringify(e.evidence), e.assessment, e.winner || 'UNRESOLVED', JSON.stringify(e.confidence_change), e.provider, e.model_id, e.status);
  }
  debate.status === 'ok' ? st.done(`${debate.entries.filter(e => e.status === 'ok').length} real exchanges`) : st.warn(debate.status === 'skipped' ? 'No opposing sides to debate' : `Debate unavailable: ${debate.error || debate.errors?.slice(-1)[0] || 'model failure'}`);

  // 11. Round 3 — Chief Judge
  st = step(steps, sessionId, 'Chief Judge analyzing');
  const judge = await runChiefJudge({ agents: agentRows, debate, contradictions, votes, snapshot, sessionId });

  // 12. Final report + trade plan
  const st2 = step(steps, sessionId, 'Generating final report');
  if (judge.status === 'ok') {
    st.done(`${judge.result.final_decision} (confidence ${judge.result.final_confidence}) via ${judge.provider}/${judge.model_id}`);
    const finalResult = {
      ...judge.result,
      vote_distribution: { buy: votes.buy, sell: votes.sell, no_trade: votes.no_trade, total: votes.total, pct: votes.pct, note: votes.note },
      risk_amount: snapshot.risk_amount,
      data_freshness: {
        market_data: marketData.status === 'OK' ? marketData.fetched_at : 'DATA_UNAVAILABLE',
        news: news.status === 'OK' ? news.fetched_at : 'DATA_UNAVAILABLE',
        macro: macro.fetched_at || 'DATA_UNAVAILABLE',
        snapshot_frozen_at: snapshot.frozen_at,
      },
      test_data: !!judge.test_data,
    };
    const plan = buildTradePlan({ judgeResult: judge.result, snapshot });
    finalResult.position_size = plan.position_size;
    db.prepare(`INSERT INTO final_decisions (id,session_id,created_at,provider,model_id,status,decision,result_json,trade_plan_json)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(newId('fd'), sessionId, nowIso(), judge.provider, judge.model_id, 'ok', judge.result.final_decision, JSON.stringify(finalResult), JSON.stringify(plan));
    db.prepare('UPDATE analysis_sessions SET status=? WHERE id=?').run('complete', sessionId);
    st2.done(`Final: ${judge.result.final_decision}`);
  } else {
    st.fail(judge.error);
    db.prepare(`INSERT INTO final_decisions (id,session_id,created_at,status,decision,error) VALUES (?,?,?,?,?,?)`)
      .run(newId('fd'), sessionId, nowIso(), 'unavailable', 'ANALYSIS_UNAVAILABLE', `Chief Judge failed: ${judge.error}`);
    db.prepare('UPDATE analysis_sessions SET status=? WHERE id=?').run('failed', sessionId);
    st2.fail('ANALYSIS_UNAVAILABLE — Chief Judge could not produce a validated decision. No fabricated output.');
  }
  audit({ session_id: sessionId, action: 'pipeline_complete', status: judge.status });
}
