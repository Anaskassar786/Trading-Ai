// server/index.js — Trading AI AK. All secrets stay server-side. No fake data anywhere.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import db, { audit } from './db.js';
import { UPLOAD_DIR, ROOT, loadRegistry, saveRegistry, secretStatus, isTestMode, getSecret, getProvider } from './config.js';
import { newId, nowIso, sha256, toNumOrNull, safeFetch } from './util.js';
import { detectFromScreenshot } from './services/vision.js';
import { createAndRunSession, detectionCache } from './services/pipeline.js';
import { fetchTimeSeries, fetchQuote } from './providers/marketdata.js';
import { fetchNewsSnapshot } from './providers/news.js';
import { fetchMacroSnapshot } from './providers/fred.js';
import * as health from './services/health.js';
import { AGENT_SPECS } from './services/agents.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const VALID_TF = ['1M', '5M', '15M', '30M', '1H', '4H', '1D', '1W'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${newId('up')}${extFor(file.mimetype)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid image type. Allowed: PNG, JPEG, WEBP.'));
  },
});
function extFor(m) { return m === 'image/png' ? '.png' : m === 'image/webp' ? '.webp' : '.jpg'; }
const UPLOAD_ID_RE = /^up_[a-z0-9_]+\.(png|jpg|webp)$/;

function validSymbol(symbol) {
  const reg = loadRegistry();
  return reg.symbols && Object.prototype.hasOwnProperty.call(reg.symbols, symbol) ? reg.symbols[symbol] : null;
}

// ---------- Upload + precheck (detection BEFORE analysis so user can resolve mismatch) ----------
app.post('/api/precheck', (req, res) => {
  upload.single('screenshot')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No screenshot uploaded.' });
    const buf = fs.readFileSync(req.file.path);
    const hash = sha256(buf);
    const userTf = VALID_TF.includes(String(req.body.user_timeframe || '').toUpperCase()) ? String(req.body.user_timeframe).toUpperCase() : null;

    let detection = detectionCache.get(hash);
    if (!detection) {
      detection = await detectFromScreenshot(req.file.path, req.file.mimetype, null);
      if (detection.status === 'OK') detectionCache.set(hash, detection);
    }
    const detectedTf = detection.status === 'OK' ? detection.detection.timeframe_detected : null;
    res.json({
      upload_id: req.file.filename,
      screenshot_hash: hash,
      mime: req.file.mimetype,
      size_bytes: req.file.size,
      detection,
      user_timeframe: userTf,
      detected_timeframe: detectedTf,
      timeframe_mismatch: !!(detectedTf && userTf && detectedTf !== userTf),
    });
  });
});

// ---------- Start analysis: ALWAYS a brand-new immutable session ----------
app.post('/api/analysis', (req, res) => {
  const { upload_id, symbol, user_timeframe } = req.body || {};
  if (!upload_id || !UPLOAD_ID_RE.test(String(upload_id))) return res.status(400).json({ error: 'Invalid or missing upload_id. Upload a screenshot first.' });
  const filePath = path.join(UPLOAD_DIR, String(upload_id));
  if (!fs.existsSync(filePath)) return res.status(400).json({ error: 'Uploaded screenshot not found. Upload again.' });
  const symCfg = validSymbol(String(symbol || ''));
  if (!symCfg) return res.status(400).json({ error: `Unknown symbol "${symbol}". Configure it in Settings → symbols.` });
  const tf = String(user_timeframe || '').toUpperCase();
  if (!VALID_TF.includes(tf)) return res.status(400).json({ error: `Invalid timeframe "${user_timeframe}". Allowed: ${VALID_TF.join(', ')}` });

  const riskAmount = toNumOrNull(req.body.risk_amount);
  const accountBalance = toNumOrNull(req.body.account_balance);
  const desiredProfit = toNumOrNull(req.body.desired_profit);
  for (const [k, v] of [['risk_amount', riskAmount], ['account_balance', accountBalance], ['desired_profit', desiredProfit]]) {
    if (v !== null && (v < 0 || v > 1e12)) return res.status(400).json({ error: `${k} out of valid range.` });
  }

  const buf = fs.readFileSync(filePath);
  const mime = upload_id.endsWith('.png') ? 'image/png' : upload_id.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const sessionId = createAndRunSession({
    symbol: String(symbol), instrumentType: symCfg.type, userTimeframe: tf,
    screenshotPath: filePath, screenshotHash: sha256(buf), screenshotMime: mime,
    riskAmount, accountBalance, desiredProfit,
  });
  audit({ session_id: sessionId, action: 'analysis_started', status: 'ok' });
  res.json({ analysis_session_id: sessionId, test_mode: isTestMode() });
});

// ---------- Session retrieval (immutable; re-fetch returns SAME stored results) ----------
app.get('/api/sessions', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.created_at, s.status, s.test_mode, s.symbol, s.user_timeframe, s.detected_timeframe, s.timeframe_used,
           s.timeframe_mismatch, s.risk_amount, f.decision AS final_decision, f.status AS final_status,
           (SELECT outcome FROM trade_outcomes o WHERE o.session_id = s.id ORDER BY o.created_at DESC LIMIT 1) AS outcome
    FROM analysis_sessions s LEFT JOIN final_decisions f ON f.session_id = s.id
    ORDER BY s.created_at DESC LIMIT 200`).all();
  res.json(rows);
});

app.get('/api/analysis/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM analysis_sessions WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const agents = db.prepare('SELECT * FROM agent_analyses WHERE session_id=? ORDER BY agent_number').all(s.id)
    .map(a => ({ ...a, result: a.result_json ? JSON.parse(a.result_json) : null, result_json: undefined }));
  const debates = db.prepare('SELECT * FROM agent_debates WHERE session_id=? ORDER BY seq').all(s.id)
    .map(d => ({ ...d, evidence: JSON.parse(d.evidence_json || '[]'), confidence_change: JSON.parse(d.confidence_change_json || 'null'), evidence_json: undefined, confidence_change_json: undefined }));
  const contradictions = db.prepare('SELECT * FROM contradictions WHERE session_id=?').all(s.id)
    .map(c => ({ ...c, detail: JSON.parse(c.detail_json || 'null'), detail_json: undefined }));
  const final = db.prepare('SELECT * FROM final_decisions WHERE session_id=?').get(s.id);
  const outcomes = db.prepare('SELECT * FROM trade_outcomes WHERE session_id=? ORDER BY created_at').all(s.id)
    .map(o => ({ ...o, review: JSON.parse(o.review_json || 'null'), review_json: undefined }));

  const snapshot = s.snapshot_json ? JSON.parse(s.snapshot_json) : null;
  if (snapshot?.market_data?.candles) snapshot.market_data.candles = snapshot.market_data.candles.slice(-60);
  if (snapshot?.market_data_higher?.candles) snapshot.market_data_higher.candles = snapshot.market_data_higher.candles.slice(-40);

  res.json({
    session: { ...s, snapshot_json: undefined, progress_json: undefined, screenshot_path: undefined },
    progress: JSON.parse(s.progress_json || '[]'),
    snapshot,
    agents, debates, contradictions,
    final: final ? { ...final, result: final.result_json ? JSON.parse(final.result_json) : null, trade_plan: final.trade_plan_json ? JSON.parse(final.trade_plan_json) : null, result_json: undefined, trade_plan_json: undefined } : null,
    outcomes,
  });
});

app.get('/api/analysis/:id/progress', (req, res) => {
  const s = db.prepare('SELECT status, progress_json, error FROM analysis_sessions WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({ status: s.status, error: s.error, steps: JSON.parse(s.progress_json || '[]') });
});

app.get('/api/screenshot/:id', (req, res) => {
  const s = db.prepare('SELECT screenshot_path, screenshot_mime FROM analysis_sessions WHERE id=?').get(req.params.id);
  if (!s || !s.screenshot_path || !fs.existsSync(s.screenshot_path)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', s.screenshot_mime || 'image/png');
  fs.createReadStream(s.screenshot_path).pipe(res);
});

// ---------- WIN/LOSS outcomes — prediction is NEVER modified ----------
app.post('/api/sessions/:id/outcome', (req, res) => {
  const s = db.prepare('SELECT id FROM analysis_sessions WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const outcome = String(req.body.outcome || '').toUpperCase();
  if (!['WIN', 'LOSS', 'BREAKEVEN', 'SKIPPED'].includes(outcome)) return res.status(400).json({ error: 'outcome must be WIN, LOSS, BREAKEVEN or SKIPPED' });

  const final = db.prepare('SELECT * FROM final_decisions WHERE session_id=?').get(s.id);
  const prediction = final?.result_json ? JSON.parse(final.result_json) : null;
  const actualEntry = toNumOrNull(req.body.actual_entry);
  const actualExit = toNumOrNull(req.body.actual_exit);
  const actualPl = toNumOrNull(req.body.actual_pl);
  const notes = req.body.notes ? String(req.body.notes).slice(0, 4000) : null;

  // Auditable, deterministic post-trade review. Does NOT modify the stored prediction
  // and does NOT auto-change any model rules.
  const review = buildOutcomeReview({ prediction, outcome, actualEntry, actualExit, actualPl, sessionId: s.id });

  const id = newId('oc');
  db.prepare(`INSERT INTO trade_outcomes (id,session_id,created_at,outcome,actual_entry,actual_exit,actual_pl,notes,review_json)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, s.id, nowIso(), outcome, actualEntry, actualExit, actualPl, notes, JSON.stringify(review));
  audit({ session_id: s.id, action: `outcome_${outcome}`, status: 'ok' });
  res.json({ id, outcome, review, note: 'Original prediction stored unchanged; outcome recorded separately.' });
});

function buildOutcomeReview({ prediction, outcome, actualEntry, actualExit, actualPl, sessionId }) {
  const findings = [];
  if (!prediction) {
    findings.push({ category: 'no_prediction', detail: 'No final decision existed for this session; outcome recorded for bookkeeping only.' });
    return { method: 'deterministic comparison of stored prediction vs reported outcome', findings, generated_at: nowIso() };
  }
  findings.push({ category: 'prediction', detail: `Stored prediction: ${prediction.final_decision} @ confidence ${prediction.final_confidence}, data_quality ${prediction.data_quality}.` });
  if (prediction.final_decision === 'NO_TRADE') findings.push({ category: 'context', detail: 'Prediction was NO_TRADE; WIN/LOSS reflects a discretionary trade outside the recommendation.' });
  if (outcome === 'WIN' && ['BUY', 'SELL'].includes(prediction.final_decision)) findings.push({ category: 'directional', detail: 'Reported outcome consistent with predicted direction (as reported by user).' });
  if (outcome === 'LOSS' && ['BUY', 'SELL'].includes(prediction.final_decision)) {
    findings.push({ category: 'directional', detail: 'Reported LOSS on predicted direction. Candidate causes below — review manually; the system does NOT auto-adjust rules from a single outcome.' });
    const ctr = db.prepare("SELECT COUNT(*) c FROM contradictions WHERE session_id=? AND kind='CONFLICTING_CLAIM'").get(sessionId)?.c || 0;
    if (ctr > 0) findings.push({ category: 'contradictions', detail: `${ctr} unresolved conflicting claims existed at analysis time — possible signal-quality issue.` });
    if (prediction.data_quality === 'LOW' || prediction.data_quality === 'INSUFFICIENT') findings.push({ category: 'data_quality', detail: `Data quality was ${prediction.data_quality} at analysis time.` });
    if (prediction.warnings?.length) findings.push({ category: 'warnings', detail: `Warnings at analysis time: ${prediction.warnings.join(' | ')}` });
    if ((prediction.invalidation_conditions || []).length) findings.push({ category: 'invalidation', detail: `Check whether a stated invalidation occurred: ${prediction.invalidation_conditions.join(' | ')}` });
  }
  if (actualEntry !== null && prediction.entry && (prediction.entry.low !== null || prediction.entry.high !== null)) {
    const lo = prediction.entry.low ?? prediction.entry.high, hi = prediction.entry.high ?? prediction.entry.low;
    findings.push({ category: 'entry_fill', detail: actualEntry >= Math.min(lo, hi) && actualEntry <= Math.max(lo, hi) ? 'Actual entry was inside the recommended entry zone.' : `Actual entry ${actualEntry} was OUTSIDE the recommended zone [${lo} – ${hi}] — execution deviation, not necessarily analysis error.` });
  }
  if (actualPl !== null) findings.push({ category: 'pl', detail: `Reported P/L: ${actualPl}.` });
  return { method: 'deterministic comparison of stored prediction vs reported outcome (auditable; no automatic rule changes)', findings, generated_at: nowIso() };
}

// ---------- Performance (denominators explicitly defined) ----------
app.get('/api/performance', (req, res) => {
  const totals = {
    total_analyses: db.prepare('SELECT COUNT(*) c FROM analysis_sessions').get().c,
    completed: db.prepare("SELECT COUNT(*) c FROM analysis_sessions WHERE status='complete'").get().c,
    failed: db.prepare("SELECT COUNT(*) c FROM analysis_sessions WHERE status='failed'").get().c,
    buy: db.prepare("SELECT COUNT(*) c FROM final_decisions WHERE decision='BUY'").get().c,
    sell: db.prepare("SELECT COUNT(*) c FROM final_decisions WHERE decision='SELL'").get().c,
    no_trade: db.prepare("SELECT COUNT(*) c FROM final_decisions WHERE decision='NO_TRADE'").get().c,
    unavailable: db.prepare("SELECT COUNT(*) c FROM final_decisions WHERE decision='ANALYSIS_UNAVAILABLE'").get().c,
  };
  const outcomes = {};
  for (const o of ['WIN', 'LOSS', 'BREAKEVEN', 'SKIPPED']) {
    outcomes[o.toLowerCase()] = db.prepare('SELECT COUNT(DISTINCT session_id) c FROM trade_outcomes WHERE outcome=?').get(o).c;
  }
  const closed = db.prepare(`
    SELECT f.decision, o.outcome FROM final_decisions f
    JOIN (SELECT session_id, outcome, MAX(created_at) FROM trade_outcomes GROUP BY session_id) o ON o.session_id=f.session_id
    WHERE f.decision IN ('BUY','SELL') AND o.outcome IN ('WIN','LOSS')`).all();
  const wins = closed.filter(r => r.outcome === 'WIN').length;
  const judge = {
    metric: 'Directional accuracy on closed outcomes',
    definition: 'Sessions where Chief Judge said BUY/SELL AND user recorded WIN or LOSS. accuracy = WIN / (WIN + LOSS). Small samples are not statistically meaningful.',
    closed_outcomes: closed.length,
    wins, losses: closed.length - wins,
    directional_accuracy_pct: closed.length ? Math.round(wins / closed.length * 1000) / 10 : null,
  };
  const agents = AGENT_SPECS.map(spec => {
    const rows = db.prepare(`
      SELECT a.result_json, f.decision AS final_decision,
        (SELECT outcome FROM trade_outcomes o WHERE o.session_id=a.session_id ORDER BY created_at DESC LIMIT 1) AS outcome,
        a.status
      FROM agent_analyses a LEFT JOIN final_decisions f ON f.session_id=a.session_id
      WHERE a.agent_number=?`).all(spec.n);
    const ok = rows.filter(r => r.status === 'ok' && r.result_json);
    const withFinal = ok.filter(r => ['BUY', 'SELL', 'NO_TRADE'].includes(r.final_decision)).map(r => ({ d: JSON.parse(r.result_json).decision, f: r.final_decision, o: r.outcome }));
    const agree = withFinal.filter(r => r.d === r.f).length;
    const closedRows = withFinal.filter(r => ['WIN', 'LOSS'].includes(r.o) && ['BUY', 'SELL'].includes(r.d));
    const agentWins = closedRows.filter(r => (r.o === 'WIN' && r.d === r.f) || (r.o === 'LOSS' && r.d !== r.f)).length;
    return {
      agent_number: spec.n, agent_name: spec.name,
      runs: rows.length, completed: ok.length, failed: rows.length - ok.length,
      agreement_with_final_pct: withFinal.length ? Math.round(agree / withFinal.length * 1000) / 10 : null,
      agreement_denominator: withFinal.length,
      closed_outcome_sample: closedRows.length,
      directionally_aligned_with_result: closedRows.length ? agentWins : null,
      note: 'Agreement rate = agent decision equals final decision (denominator shown). Outcome alignment uses only closed WIN/LOSS trades.',
    };
  });
  res.json({ totals, outcomes, chief_judge: judge, agents });
});

// ---------- Market / news / macro pages (live fetch on demand, honest failures) ----------
app.get('/api/market/:base/:quote', async (req, res) => {
  const symbol = `${req.params.base}/${req.params.quote}`.toUpperCase();
  if (!validSymbol(symbol)) return res.status(400).json({ error: `Symbol ${symbol} not configured` });
  const tf = VALID_TF.includes(String(req.query.tf || '').toUpperCase()) ? String(req.query.tf).toUpperCase() : '4H';
  const [series, quote] = await Promise.all([fetchTimeSeries(symbol, tf, 120), fetchQuote(symbol)]);
  res.json({ series, quote });
});
app.get('/api/news', async (req, res) => {
  const symbol = String(req.query.symbol || 'XAU/USD').toUpperCase();
  const cfg = validSymbol(symbol);
  if (!cfg) return res.status(400).json({ error: `Symbol ${symbol} not configured` });
  res.json(await fetchNewsSnapshot(symbol, cfg.type));
});
app.get('/api/macro', async (req, res) => res.json(await fetchMacroSnapshot()));

// ---------- API Health ----------
app.get('/api/health/last', (req, res) => res.json({ providers: health.lastKnown(), secrets: secretStatus(), test_mode: isTestMode() }));
app.post('/api/health/check', async (req, res) => {
  const results = await health.checkAll();
  res.json({ providers: results, secrets: secretStatus(), test_mode: isTestMode() });
});

// ---------- Settings (registry only — NEVER secrets values) ----------
app.get('/api/settings', (req, res) => {
  res.json({ registry: loadRegistry(), secrets: secretStatus(), test_mode: isTestMode(), agents: AGENT_SPECS.map(a => ({ n: a.n, name: a.name, requires_vision: a.vision })) });
});
app.put('/api/settings/registry', (req, res) => {
  try { res.json({ ok: true, registry: saveRegistry(req.body) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Fetch real model lists from a provider so the user can pick valid IDs.
app.get('/api/settings/provider-models/:provider', async (req, res) => {
  const p = getProvider(req.params.provider);
  if (!p) return res.status(404).json({ error: 'Unknown provider' });
  const key = getSecret(p.key_env);
  if (!key) return res.json({ status: 'NOT CONFIGURED', error: `${p.key_env} NOT CONFIGURED` });
  if (!p.base_url) return res.json({ status: 'NOT CONFIGURED', error: 'Base URL NOT CONFIGURED' });
  const r = p.type === 'gemini'
    ? await safeFetch(`${p.base_url}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, { timeoutMs: 12000, retries: 0 })
    : await safeFetch(`${p.base_url}/models`, { headers: { Authorization: `Bearer ${key}` } }, { timeoutMs: 12000, retries: 0 });
  if (!r.ok) return res.json({ status: 'FAIL', error: r.error });
  const ids = p.type === 'gemini'
    ? (r.json?.models || []).map(m => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || null }))
    : (r.json?.data || []).map(m => ({ id: m.id, label: null }));
  res.json({ status: 'OK', models: ids });
});

// ---------- Audit log ----------
app.get('/api/audit', (req, res) => {
  const sid = req.query.session_id ? String(req.query.session_id) : null;
  const rows = sid
    ? db.prepare('SELECT * FROM audit_log WHERE session_id=? ORDER BY id DESC LIMIT 500').all(sid)
    : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Bad request' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Trading AI AK listening on 0.0.0.0:${PORT} — TEST_MODE=${isTestMode()}`);
});
