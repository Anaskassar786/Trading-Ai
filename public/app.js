/* Trading AI AK — frontend. Talks ONLY to same-origin /api/*. No API keys exist here. */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const state = {
  sessionId: localStorage.getItem('ak_session') || null,
  session: null,           // full session payload cache
  precheck: null,          // last precheck result
  pollTimer: null,
};

const TF = ['1M', '5M', '15M', '30M', '1H', '4H', '1D', '1W'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n === null || n === undefined) ? '<span class="muted">—</span>' : esc(typeof n === 'number' ? String(n) : n);
const ts = t => t ? new Date(t).toLocaleString() : '—';

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

function decBadge(d) {
  if (d === 'BUY') return '<span class="badge buy">BUY</span>';
  if (d === 'SELL') return '<span class="badge sell">SELL</span>';
  if (d === 'NO_TRADE') return '<span class="badge neutral">NO TRADE</span>';
  if (d === 'ANALYSIS_UNAVAILABLE') return '<span class="badge err">ANALYSIS UNAVAILABLE</span>';
  return `<span class="badge dim">${esc(d || '—')}</span>`;
}
function dqBadge(q) {
  const cls = q === 'HIGH' ? 'ok' : q === 'MEDIUM' ? 'info' : q === 'LOW' ? 'warn' : 'err';
  return `<span class="badge ${cls}">DATA: ${esc(q || 'UNKNOWN')}</span>`;
}
function list(items, cls = 'evlist') {
  if (!items || !items.length) return '<div class="muted" style="font-size:12px">None recorded.</div>';
  return `<ul class="${cls}">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function setSession(id) {
  state.sessionId = id;
  state.session = null;
  if (id) localStorage.setItem('ak_session', id); else localStorage.removeItem('ak_session');
  renderSessionBar();
}
function renderSessionBar() {
  const bar = $('#sessionBar');
  if (!state.sessionId) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#sessionBarId').textContent = state.sessionId;
  const s = state.session?.session;
  $('#sessionBarMeta').innerHTML = s ? ` — ${esc(s.symbol)} · ${esc(s.timeframe_used || s.user_timeframe || '')} · ${esc(s.status)}${s.test_mode ? ' · <span class="badge warn">TEST DATA</span>' : ''}` : '';
}
async function loadSession(force = false) {
  if (!state.sessionId) return null;
  if (state.session && !force) return state.session;
  state.session = await api(`/api/analysis/${state.sessionId}`);
  renderSessionBar();
  return state.session;
}

/* ---------------- Router ---------------- */
const routes = {
  dashboard: vDashboard, new: vNew, running: vRunning, council: vCouncil, debate: vDebate,
  final: vFinal, plan: vPlan, risk: vRisk, history: vHistory, performance: vPerformance,
  market: vMarket, news: vNews, macro: vMacro, health: vHealth, settings: vSettings,
};
function navigate() {
  clearInterval(state.pollTimer);
  const name = (location.hash || '#dashboard').slice(1).split('?')[0];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.v === name));
  view.innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  (routes[name] || vDashboard)().catch(e => {
    view.innerHTML = `<div class="alert err"><b>Error:</b> ${esc(e.message)}</div>`;
  });
}
window.addEventListener('hashchange', navigate);

/* ---------------- Dashboard ---------------- */
async function vDashboard() {
  const [perf, sessions] = await Promise.all([api('/api/performance'), api('/api/sessions')]);
  const t = perf.totals, o = perf.outcomes;
  view.innerHTML = `
    <h1>Dashboard</h1>
    <div class="grid g4">
      ${stat('Total analyses', t.total_analyses)}${stat('Completed', t.completed)}${stat('Failed / unavailable', t.failed)}
      ${stat('BUY calls', t.buy)}${stat('SELL calls', t.sell)}${stat('NO TRADE calls', t.no_trade)}
      ${stat('Wins recorded', o.win)}${stat('Losses recorded', o.loss)}
    </div>
    <h2>Recent sessions</h2>
    ${sessionsTable(sessions.slice(0, 10))}
    ${sessions.length ? '' : '<div class="empty">No analyses yet. Start with <a href="#new">New Analysis</a>.</div>'}`;
}
function stat(l, v) { return `<div class="stat"><div class="l">${esc(l)}</div><div class="v">${v ?? 0}</div></div>`; }
function sessionsTable(rows) {
  if (!rows.length) return '';
  return `<div class="card" style="padding:0;overflow-x:auto"><table>
    <tr><th>Created</th><th>Symbol</th><th>TF</th><th>Status</th><th>Decision</th><th>Outcome</th><th></th></tr>
    ${rows.map(r => `<tr>
      <td>${ts(r.created_at)}${r.test_mode ? ' <span class="badge warn">TEST</span>' : ''}</td>
      <td>${esc(r.symbol)}</td>
      <td>${esc(r.timeframe_used || r.user_timeframe || '—')}${r.timeframe_mismatch ? ' <span class="badge warn" title="user/detected mismatch">MISMATCH</span>' : ''}</td>
      <td><span class="badge ${r.status === 'complete' ? 'ok' : r.status === 'running' ? 'info' : 'err'}">${esc(r.status)}</span></td>
      <td>${decBadge(r.final_decision)}</td>
      <td>${r.outcome ? `<span class="badge ${r.outcome === 'WIN' ? 'ok' : r.outcome === 'LOSS' ? 'err' : 'dim'}">${esc(r.outcome)}</span>` : '<span class="muted">—</span>'}</td>
      <td><button class="btn small ghost" onclick="openSession('${esc(r.id)}')">Open</button></td>
    </tr>`).join('')}
  </table></div>`;
}
window.openSession = (id) => { setSession(id); location.hash = '#final'; if (location.hash === '#final') navigate(); };

/* ---------------- New Analysis ---------------- */
async function vNew() {
  const settings = await api('/api/settings');
  const symbols = Object.entries(settings.registry.symbols || {});
  view.innerHTML = `
    <h1>New Analysis</h1>
    ${settings.test_mode ? '<div class="alert warn"><b>TEST MODE is enabled.</b> No live data will be fetched; all outputs are labelled TEST DATA.</div>' : ''}
    <div class="grid g2">
      <div class="card">
        <h3>1 · Chart screenshot</h3>
        <label>Screenshot (PNG / JPEG / WEBP, max 8 MB)</label>
        <input type="file" id="shot" accept="image/png,image/jpeg,image/webp" />
        <div id="shotPreview"></div>
        <label>Instrument</label>
        <select id="instrument"><option value="metal">Gold / Metals</option><option value="forex">Forex</option></select>
        <label>Symbol</label>
        <select id="symbol">${symbols.map(([k, v]) => `<option value="${esc(k)}" data-type="${esc(v.type)}">${esc(k)} — ${esc(v.label)}</option>`).join('')}</select>
        <label>Your timeframe</label>
        <select id="tf">${TF.map(t => `<option ${t === '4H' ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <div style="margin-top:14px"><button class="btn ghost" id="precheckBtn">Detect symbol & timeframe</button></div>
        <div id="precheckOut"></div>
      </div>
      <div class="card">
        <h3>2 · Risk inputs</h3>
        <label>Risk amount (required for position sizing; analysis works without balance)</label>
        <input type="number" id="risk" min="0" step="any" placeholder="e.g. 500" />
        <label>Account balance (optional)</label>
        <input type="number" id="balance" min="0" step="any" placeholder="optional" />
        <label>Desired profit (optional)</label>
        <input type="number" id="profit" min="0" step="any" placeholder="optional" />
        <div class="alert info" style="margin-top:16px">The council analyzes an immutable frozen snapshot. Every press of Analyze creates a <b>new</b> session — previous sessions are never overwritten.</div>
        <button class="btn" id="analyzeBtn" style="margin-top:8px;width:100%">Analyze — run 10-agent council</button>
        <div id="analyzeOut"></div>
      </div>
    </div>`;

  $('#instrument').onchange = () => {
    const t = $('#instrument').value;
    [...$('#symbol').options].forEach(o => { o.hidden = o.dataset.type !== t && !(t === 'metal' && o.dataset.type === 'metal'); });
    const first = [...$('#symbol').options].find(o => !o.hidden);
    if (first && $('#symbol').selectedOptions[0]?.hidden) $('#symbol').value = first.value;
  };
  $('#shot').onchange = () => {
    state.precheck = null; $('#precheckOut').innerHTML = '';
    const f = $('#shot').files[0];
    $('#shotPreview').innerHTML = f ? `<img class="shot" style="margin-top:10px;max-height:220px" src="${URL.createObjectURL(f)}" alt="screenshot preview" />` : '';
  };

  $('#precheckBtn').onclick = () => runPrecheck(false);
  $('#analyzeBtn').onclick = async () => {
    const btn = $('#analyzeBtn');
    const out = $('#analyzeOut');
    try {
      if (!$('#shot').files[0]) throw new Error('Upload a chart screenshot first.');
      btn.disabled = true;
      if (!state.precheck) {
        out.innerHTML = '<div class="loading"><span class="spinner"></span>Uploading & inspecting screenshot…</div>';
        await runPrecheck(true);
      }
      const p = state.precheck;
      if (p.timeframe_mismatch && !confirm(`TIMEFRAME MISMATCH\n\nDetected on screenshot: ${p.detected_timeframe}\nYou selected: ${p.user_timeframe}\n\nContinue? The analysis will use the DETECTED timeframe (${p.detected_timeframe}) and state this clearly.`)) {
        btn.disabled = false; out.innerHTML = '<div class="alert warn">Cancelled — adjust your timeframe selection or upload the intended chart.</div>'; return;
      }
      out.innerHTML = '<div class="loading"><span class="spinner"></span>Creating analysis session…</div>';
      const r = await api('/api/analysis', { method: 'POST', body: {
        upload_id: p.upload_id, symbol: $('#symbol').value, user_timeframe: $('#tf').value,
        risk_amount: $('#risk').value || null, account_balance: $('#balance').value || null, desired_profit: $('#profit').value || null,
      } });
      setSession(r.analysis_session_id);
      location.hash = '#running';
    } catch (e) {
      out.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
      btn.disabled = false;
    }
  };

  async function runPrecheck(quiet) {
    const f = $('#shot').files[0];
    if (!f) throw new Error('Upload a chart screenshot first.');
    if (!quiet) $('#precheckOut').innerHTML = '<div class="loading"><span class="spinner"></span>Uploading & running vision detection…</div>';
    const fd = new FormData();
    fd.append('screenshot', f);
    fd.append('user_timeframe', $('#tf').value);
    const p = await api('/api/precheck', { method: 'POST', body: fd });
    state.precheck = p;
    const d = p.detection;
    let html = `<div class="kv" style="margin-top:12px">
      <dt>Screenshot hash</dt><dd>${esc(p.screenshot_hash.slice(0, 16))}…</dd>`;
    if (d.status === 'OK') {
      html += `<dt>Detected symbol</dt><dd>${fmt(d.detection.symbol_detected) || 'NOT VISIBLE'}</dd>
        <dt>Detected timeframe</dt><dd>${fmt(d.detection.timeframe_detected)}</dd>
        <dt>User timeframe</dt><dd>${esc(p.user_timeframe || '—')}</dd>
        <dt>Platform</dt><dd>${fmt(d.detection.platform)}</dd>
        <dt>Detection confidence</dt><dd>${fmt(d.detection.confidence)}/100</dd></div>`;
      html += p.timeframe_mismatch
        ? `<div class="alert warn"><b>Mismatch detected.</b> Detected timeframe: ${esc(p.detected_timeframe)} · User-selected: ${esc(p.user_timeframe)}. If you continue, analysis uses the DETECTED timeframe.</div>`
        : (p.detected_timeframe ? '<div class="alert info">Timeframe match confirmed.</div>' : '<div class="alert warn">Timeframe not readable from screenshot — the analysis will use your selected timeframe and note this.</div>');
      if (d.detection.chart_description) html += `<div class="alert info">${esc(d.detection.chart_description)}</div>`;
    } else {
      html += `</div><div class="alert err"><b>IMAGE_ANALYSIS_UNAVAILABLE.</b> ${esc(d.reason)}<br>You can still analyze: agents will rely on market data only and data quality will reflect the missing chart inspection.</div>`;
    }
    $('#precheckOut').innerHTML = html;
    return p;
  }
}

/* ---------------- Analysis Running ---------------- */
async function vRunning() {
  if (!state.sessionId) { view.innerHTML = emptyNoSession(); return; }
  view.innerHTML = `<h1>Analysis Running</h1><div class="card"><ul class="steps" id="steps"></ul></div><div id="runFoot"></div>`;
  const render = async () => {
    let p;
    try { p = await api(`/api/analysis/${state.sessionId}/progress`); } catch (e) { clearInterval(state.pollTimer); return; }
    $('#steps').innerHTML = p.steps.map(s => `<li>
      <span class="ic">${s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : s.status === 'warning' ? '⚠️' : '<span class="spinner"></span>'}</span>
      <span><b>${esc(s.label)}</b>${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}</span>
    </li>`).join('') || '<li><span class="ic"><span class="spinner"></span></span><span>Starting…</span></li>';
    if (p.status === 'complete') {
      clearInterval(state.pollTimer);
      $('#runFoot').innerHTML = '<div class="alert info"><b>Analysis complete.</b></div><a class="btn" href="#final">View Final Decision</a> <a class="btn ghost" href="#council">Agent Council</a>';
      await loadSession(true);
    } else if (p.status === 'failed') {
      clearInterval(state.pollTimer);
      $('#runFoot').innerHTML = `<div class="alert err"><b>Analysis unavailable.</b> ${esc(p.error || 'See steps above for the failing stage. No fabricated result was produced.')}</div><a class="btn ghost" href="#council">Inspect agent errors</a>`;
      await loadSession(true);
    }
  };
  await render();
  state.pollTimer = setInterval(render, 2500);
}
function emptyNoSession() {
  return `<div class="empty">No active analysis session.<br><br><a class="btn" href="#new">Start a New Analysis</a> &nbsp; <a class="btn ghost" href="#history">Open from history</a></div>`;
}

/* ---------------- Agent Council ---------------- */
async function vCouncil() {
  if (!state.sessionId) { view.innerHTML = emptyNoSession(); return; }
  const s = await loadSession(true);
  const votes = s.final?.result?.vote_distribution;
  view.innerHTML = `
    <h1>Agent Council <span class="muted" style="font-size:13px">Round 1 — 10 independent analyses of the same frozen snapshot</span></h1>
    ${s.session.test_mode ? '<div class="alert warn">TEST DATA — this session was produced in TEST MODE.</div>' : ''}
    ${votes ? voteBar(votes) : ''}
    <div class="grid g2">
      ${s.agents.map(agentCard).join('') || '<div class="empty">No agent results yet.</div>'}
    </div>
    <h2>Screenshot</h2>
    <img class="shot" style="max-height:420px" src="/api/screenshot/${esc(s.session.id)}" alt="analyzed chart screenshot" onerror="this.outerHTML='<div class=empty>Screenshot not available</div>'" />`;
}
function voteBar(v) {
  const p = v.pct || v;
  return `<div class="card"><b>Agent vote distribution</b> <span class="muted">(${v.total} completed agents — NOT probability of profit)</span>
    <div class="votebar">
      ${v.buy ? `<div class="b" style="flex:${v.buy}">BUY ${p.buy}%</div>` : ''}
      ${v.sell ? `<div class="s" style="flex:${v.sell}">SELL ${p.sell}%</div>` : ''}
      ${v.no_trade ? `<div class="n" style="flex:${v.no_trade}">NO TRADE ${p.no_trade}%</div>` : ''}
    </div></div>`;
}
function agentCard(a) {
  if (a.status !== 'ok' || !a.result) {
    return `<div class="agent-card"><header><div><div class="agent-name">Agent ${a.agent_number} — ${esc(a.agent_name)}</div></div><span class="badge err">FAILED</span></header>
      <div class="alert err" style="font-size:12px">${esc(a.error || 'Model call failed. No fabricated result shown.')}</div></div>`;
  }
  const r = a.result;
  return `<div class="agent-card">
    <header>
      <div><div class="agent-name">Agent ${r.agent_number} — ${esc(r.agent_name)}</div>
      <div class="agent-model">${esc(a.provider || '?')}/${esc(a.model_id || '?')} · ${a.latency_ms ? a.latency_ms + 'ms' : ''}</div></div>
      <div style="text-align:right">${decBadge(r.decision)}<br>${dqBadge(r.data_quality)}</div>
    </header>
    <div class="muted" style="font-size:12px">Confidence ${r.confidence}/100 <i>(analytical, not win probability)</i></div>
    <div class="confbar"><div style="width:${r.confidence}%"></div></div>
    <dl class="kv">
      <dt>Entry zone</dt><dd>${fmt(r.entry_zone?.low)} – ${fmt(r.entry_zone?.high)}</dd>
      <dt>Stop loss</dt><dd>${fmt(r.stop_loss)}</dd>
      <dt>TP1 / TP2 / TP3</dt><dd>${fmt(r.take_profit_1)} / ${fmt(r.take_profit_2)} / ${fmt(r.take_profit_3)}</dd>
      <dt>R:R</dt><dd>${fmt(r.risk_reward)}</dd>
    </dl>
    <details><summary>Evidence (${r.evidence.length})</summary>${list(r.evidence)}</details>
    <details><summary>Supporting / contradicting factors</summary>
      <b style="font-size:12px">Supporting</b>${list(r.supporting_factors)}
      <b style="font-size:12px">Contradicting</b>${list(r.contradicting_factors)}</details>
    <details><summary>Invalidation conditions</summary>${list(r.invalidation_conditions)}</details>
    ${r.warnings?.length ? `<div class="alert warn" style="font-size:12px">${r.warnings.map(esc).join('<br>')}</div>` : ''}
  </div>`;
}

/* ---------------- Debate Room ---------------- */
async function vDebate() {
  if (!state.sessionId) { view.innerHTML = emptyNoSession(); return; }
  const s = await loadSession(true);
  const name = n => { const a = s.agents.find(x => x.agent_number === n); return a ? `Agent ${n} — ${a.agent_name}` : `Agent ${n}`; };
  const dec = n => s.agents.find(x => x.agent_number === n)?.result?.decision || '?';
  const conflicts = s.contradictions.filter(c => c.kind === 'CONFLICTING_CLAIM');
  const facts = s.contradictions.filter(c => c.kind === 'CONFIRMED_FACT');
  const unresolved = s.contradictions.filter(c => c.kind === 'UNRESOLVED_CLAIM');
  view.innerHTML = `
    <h1>Debate Room <span class="muted" style="font-size:13px">Round 2 — real adversarial exchanges</span></h1>
    ${s.final?.result?.vote_distribution ? voteBar(s.final.result.vote_distribution) : ''}
    ${s.debates.length ? s.debates.map(d => `
      <div class="debate-entry">
        <div class="head">
          <span class="badge ${dec(d.challenger_agent) === 'BUY' ? 'buy' : dec(d.challenger_agent) === 'SELL' ? 'sell' : 'neutral'}">${esc(dec(d.challenger_agent))}</span>
          <b>${esc(name(d.challenger_agent))}</b> challenged
          <span class="badge ${dec(d.challenged_agent) === 'BUY' ? 'buy' : dec(d.challenged_agent) === 'SELL' ? 'sell' : 'neutral'}">${esc(dec(d.challenged_agent))}</span>
          <b>${esc(name(d.challenged_agent))}</b>
          <span class="right badge ${d.status === 'ok' ? 'info' : 'err'}">${d.status === 'ok' ? esc(d.winner || 'UNRESOLVED') : 'DEBATE UNAVAILABLE'}</span>
        </div>
        <div class="bubble" style="background:var(--panel2)"><div class="who">Claim under challenge</div>${esc(d.claim || '—')}</div>
        ${d.status === 'ok' ? `
          <div class="bubble challenge"><div class="who">Challenge — ${esc(name(d.challenger_agent))}</div>${esc(d.challenge)}</div>
          <div class="bubble counter"><div class="who">Counterargument — ${esc(name(d.challenged_agent))}</div>${esc(d.counterclaim)}</div>
          ${d.evidence?.length ? `<div class="bubble" style="background:transparent"><div class="who">Evidence referenced</div>${list(d.evidence)}</div>` : ''}
          <div class="bubble assess"><div class="who">Assessment (winner: ${esc(d.winner)})</div>${esc(d.assessment)}
            ${d.confidence_change ? `<div class="muted" style="font-size:11px;margin-top:4px">Confidence deltas — challenger ${d.confidence_change.challenger_delta}, challenged ${d.confidence_change.challenged_delta}</div>` : ''}</div>
          <div class="muted" style="font-size:11px;padding:0 14px 10px">via ${esc(d.provider)}/${esc(d.model_id)}</div>`
        : `<div class="alert err" style="margin:10px 14px">${esc(d.assessment || 'Model call failed — no fabricated debate transcript shown.')}</div>`}
      </div>`).join('')
    : '<div class="empty">No debate exchanges. Either the council was unanimous, agents failed, or the debate model was unavailable — see Analysis Running log.</div>'}
    <h2>Contradiction engine</h2>
    <div class="grid g3">
      <div class="card"><h3>⚔️ Conflicting claims (${conflicts.length})</h3>${ctrList(conflicts)}</div>
      <div class="card"><h3>✔ Corroborated facts (${facts.length})</h3>${ctrList(facts)}</div>
      <div class="card"><h3>❓ Unresolved single claims (${unresolved.length})</h3>${ctrList(unresolved)}</div>
    </div>`;
}
function ctrList(items) {
  if (!items.length) return '<div class="muted" style="font-size:12px">None.</div>';
  return items.map(c => `<details><summary>${esc(c.topic)}</summary>
    <div style="font-size:12px">${esc(c.detail.summary)}</div>
    ${['claims', 'buy_claims', 'sell_claims'].map(k => c.detail[k]?.length ? `<b style="font-size:11px">${k.replace('_', ' ')}</b><ul class="evlist">${c.detail[k].map(x => `<li><b>A${x.agent}:</b> ${esc(x.claim)}</li>`).join('')}</ul>` : '').join('')}
    ${c.detail.resolution ? `<div class="muted" style="font-size:11px">${esc(c.detail.resolution)}</div>` : ''}</details>`).join('');
}

/* ---------------- Final Decision ---------------- */
async function vFinal() {
  if (!state.sessionId) { view.innerHTML = emptyNoSession(); return; }
  const s = await loadSession(true);
  const f = s.final;
  if (!f) {
    view.innerHTML = `<h1>Final Decision</h1><div class="empty">No final decision yet for this session (status: ${esc(s.session.status)}).<br><br><a class="btn ghost" href="#running">View progress</a></div>`;
    return;
  }
  const r = f.result;
  if (f.status !== 'ok' || !r) {
    view.innerHTML = `<h1>Final Decision</h1>
      <div class="final-hero"><div class="dec ANALYSIS_UNAVAILABLE">ANALYSIS UNAVAILABLE</div>
      <p class="muted">${esc(f.error || 'The Chief Judge could not produce a validated decision. No fabricated output is shown.')}</p></div>`;
    return;
  }
  const v = r.vote_distribution;
  view.innerHTML = `
    <h1>Chief Judge — Final Decision</h1>
    ${s.session.test_mode || r.test_data ? '<div class="alert warn"><b>TEST DATA</b> — produced in TEST MODE, not a real analysis.</div>' : ''}
    <div class="final-hero">
      <div class="dec ${esc(r.final_decision)}">${esc(r.final_decision.replace('_', ' '))}</div>
      <div class="muted">Chief Judge confidence: <b>${r.final_confidence}/100</b> (analytical confidence — not probability of profit)</div>
      <div style="max-width:520px;margin:14px auto 0">${voteBar(v)}</div>
      <div class="muted" style="font-size:11px">via ${esc(f.provider)}/${esc(f.model_id)} · ${ts(f.created_at)} · ${dqBadge(r.data_quality)}</div>
    </div>
    <div class="grid g3">
      ${stat('Entry zone', `${r.entry.low ?? '—'} – ${r.entry.high ?? '—'}`)}
      ${stat('Stop loss', r.stop_loss ?? '—')}
      ${stat('TP1 / TP2 / TP3', `${r.targets.tp1 ?? '—'} / ${r.targets.tp2 ?? '—'} / ${r.targets.tp3 ?? '—'}`)}
      ${stat('Risk amount', r.risk_amount ?? 'not provided')}
      ${stat('Position size', r.position_size ? `${r.position_size.lots} lots` : 'unavailable')}
      ${stat('Risk : Reward', r.risk_reward ?? '—')}
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h3>WHY?</h3><p style="font-size:13px">${esc(r.decision_summary)}</p>
        <h3>Timeframe alignment</h3><p style="font-size:13px">${esc(r.timeframe_alignment || '—')}</p></div>
      <div class="card"><h3>WHY NOT ${r.final_decision === 'BUY' ? 'SELL' : r.final_decision === 'SELL' ? 'BUY' : 'A TRADE'}?</h3>
        <p style="font-size:13px">${esc(r.why_not_opposite || '—')}</p>
        <h3>Rejected arguments</h3>${list(r.rejected_arguments)}</div>
      <div class="card"><h3>Strongest bullish arguments</h3>${list(r.strongest_bullish_arguments)}</div>
      <div class="card"><h3>Strongest bearish arguments</h3>${list(r.strongest_bearish_arguments)}</div>
      <div class="card"><h3>WHAT INVALIDATES THIS?</h3>${list(r.invalidation_conditions)}</div>
      <div class="card"><h3>Important warnings</h3>${list(r.warnings)}
        <h3>Data freshness</h3><dl class="kv">
          <dt>Snapshot frozen</dt><dd>${esc(r.data_freshness?.snapshot_frozen_at || '—')}</dd>
          <dt>Market data</dt><dd>${esc(r.data_freshness?.market_data || '—')}</dd>
          <dt>News</dt><dd>${esc(r.data_freshness?.news || '—')}</dd>
          <dt>Macro</dt><dd>${esc(r.data_freshness?.macro || '—')}</dd></dl></div>
    </div>
    <div style="margin-top:14px"><a class="btn" href="#plan">Trade Plan</a> <a class="btn ghost" href="#debate">Debate Room</a> <a class="btn ghost" href="#council">Agent Council</a></div>`;
}

/* ---------------- Trade Plan ---------------- */
async function vPlan() {
  if (!state.sessionId) { view.innerHTML = emptyNoSession(); return; }
  const s = await loadSession();
  const p = s.final?.trade_plan;
  if (!p) { view.innerHTML = `<h1>Trade Plan</h1><div class="empty">No trade plan for this session${s.final ? ` (final decision: ${esc(s.final.decision)})` : ''}.</div>`; return; }
  view.innerHTML = `
    <h1>Trade Plan</h1>
    ${!p.tradeable ? `<div class="alert info"><b>${esc(p.decision)}</b> — ${esc(p.reason)}</div>` : `
    <div class="grid g3">
      ${stat('Direction', p.decision)}${stat('Symbol', p.symbol)}
      ${stat('Entry zone', `${p.entry_zone.low ?? '—'} – ${p.entry_zone.high ?? '—'}`)}
      ${stat('Entry reference', p.entry_reference ?? '—')}${stat('Stop loss', p.stop_loss ?? '—')}
      ${stat('TP1 / TP2 / TP3', `${p.targets.tp1 ?? '—'} / ${p.targets.tp2 ?? '—'} / ${p.targets.tp3 ?? '—'}`)}
      ${stat('Risk amount', p.risk_amount ?? 'not provided')}
      ${stat('Position size', p.position_size ? `${p.position_size.lots} lots (${p.position_size.units} units)` : 'UNAVAILABLE')}
      ${stat('R:R (judge)', p.risk_reward ?? '—')}
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h3>Recomputed R:R from actual levels</h3>
        <dl class="kv">${Object.entries(p.computed || {}).map(([k, v]) => `<dt>${esc(k.replace('rr_', 'R:R to ').toUpperCase())}</dt><dd>1 : ${v}</dd>`).join('') || '<dt>—</dt><dd>Insufficient levels to compute</dd>'}</dl>
        ${p.position_size ? `<h3>Sizing basis</h3><dl class="kv">
          <dt>Contract</dt><dd>${esc(p.position_size.spec.lot_label)}</dd>
          <dt>Risk per lot</dt><dd>$${p.position_size.risk_per_lot_usd}</dd>
          <dt>Quote currency</dt><dd>${esc(p.position_size.spec.quote_currency)}</dd></dl>` : `<div class="alert warn">${esc(p.position_size_reason || 'Position size unavailable.')}</div>`}
      </div>
      <div class="card"><h3>Warnings</h3>${list(p.warnings)}</div>
    </div>`}`;
}

/* ---------------- Risk Calculator ---------------- */
const INSTR = {
  'XAU/USD': { cs: 100, lot: '1 lot = 100 oz', q: 'USD' }, 'XAG/USD': { cs: 5000, lot: '1 lot = 5,000 oz', q: 'USD' },
  'EUR/USD': { cs: 100000, lot: '1 lot = 100k EUR', q: 'USD' }, 'GBP/USD': { cs: 100000, lot: '1 lot = 100k GBP', q: 'USD' },
  'AUD/USD': { cs: 100000, lot: '1 lot = 100k AUD', q: 'USD' }, 'NZD/USD': { cs: 100000, lot: '1 lot = 100k NZD', q: 'USD' },
  'USD/JPY': { cs: 100000, lot: '1 lot = 100k USD', q: 'JPY' }, 'USD/CHF': { cs: 100000, lot: '1 lot = 100k USD', q: 'CHF' }, 'USD/CAD': { cs: 100000, lot: '1 lot = 100k USD', q: 'CAD' },
};
async function vRisk() {
  view.innerHTML = `
    <h1>Risk Calculator</h1>
    <div class="grid g2"><div class="card">
      <label>Symbol</label><select id="rcSym">${Object.keys(INSTR).map(s => `<option>${s}</option>`).join('')}</select>
      <label>Entry price</label><input id="rcEntry" type="number" step="any" />
      <label>Stop loss price</label><input id="rcSl" type="number" step="any" />
      <label>Risk amount (USD)</label><input id="rcRisk" type="number" step="any" />
      <label>Conversion rate (USD → quote currency; only for non-USD-quoted pairs, e.g. current USD/JPY price)</label><input id="rcConv" type="number" step="any" placeholder="required only for USD/JPY, USD/CHF, USD/CAD" />
      <div style="margin-top:12px"><button class="btn" id="rcGo">Calculate</button></div>
    </div><div class="card"><h3>Result</h3><div id="rcOut" class="empty">Enter values and calculate.</div></div></div>
    <div class="alert info">Deterministic math only — no market data is fetched or assumed. Contract sizes are standard; verify with your broker. This calculator never guarantees outcomes.</div>`;
  $('#rcGo').onclick = () => {
    const sym = $('#rcSym').value, spec = INSTR[sym];
    const e = parseFloat($('#rcEntry').value), sl = parseFloat($('#rcSl').value), risk = parseFloat($('#rcRisk').value), conv = parseFloat($('#rcConv').value);
    const out = $('#rcOut');
    if (!isFinite(e) || !isFinite(sl) || !isFinite(risk) || risk <= 0) { out.innerHTML = '<div class="alert err">Entry, stop loss and a positive risk amount are required.</div>'; return; }
    const dist = Math.abs(e - sl);
    if (dist <= 0) { out.innerHTML = '<div class="alert err">Stop distance is zero.</div>'; return; }
    let perLotQuote = dist * spec.cs, perLotUSD;
    if (spec.q === 'USD') perLotUSD = perLotQuote;
    else if (isFinite(conv) && conv > 0) perLotUSD = perLotQuote / conv;
    else { out.innerHTML = `<div class="alert warn">Position size unavailable: ${sym} is quoted in ${spec.q}. Enter the current USD→${spec.q} conversion rate — it is not assumed.</div>`; return; }
    const lots = Math.floor(risk / perLotUSD * 100) / 100;
    out.innerHTML = `<dl class="kv">
      <dt>Stop distance</dt><dd>${dist}</dd>
      <dt>Risk per 1.00 lot</dt><dd>$${perLotUSD.toFixed(2)}</dd>
      <dt>Position size</dt><dd><b>${lots} lots</b> (${Math.floor(lots * spec.cs)} units)</dd>
      <dt>Contract</dt><dd>${spec.lot}</dd>
      <dt>Approx. risk at this size</dt><dd>$${(lots * perLotUSD).toFixed(2)} (rounded down, never above your risk)</dd></dl>`;
  };
}

/* ---------------- Trade History + outcomes ---------------- */
async function vHistory() {
  const sessions = await api('/api/sessions');
  view.innerHTML = `
    <h1>Trade History</h1>
    ${sessions.length ? sessionsTable(sessions) : '<div class="empty">No sessions yet.</div>'}
    <h2>Record outcome for active session</h2>
    <div id="outcomePanel">${state.sessionId ? '' : '<div class="empty">Open a session first (click Open on a row).</div>'}</div>`;
  if (!state.sessionId) return;
  const s = await loadSession();
  const pred = s.final?.result;
  $('#outcomePanel').innerHTML = `
    <div class="grid g2"><div class="card">
      <div><b>${esc(state.sessionId)}</b> — prediction: ${decBadge(s.final?.decision)} ${pred ? `confidence ${pred.final_confidence}/100` : ''}</div>
      <label>Outcome</label><select id="ocSel"><option>WIN</option><option>LOSS</option><option>BREAKEVEN</option><option>SKIPPED</option></select>
      <label>Actual entry (optional)</label><input id="ocEntry" type="number" step="any" />
      <label>Actual exit (optional)</label><input id="ocExit" type="number" step="any" />
      <label>Actual P/L (optional)</label><input id="ocPl" type="number" step="any" />
      <label>Notes (optional)</label><textarea id="ocNotes" rows="3"></textarea>
      <div style="margin-top:10px"><button class="btn" id="ocGo">Record outcome</button></div>
      <div class="muted" style="font-size:12px;margin-top:8px">The original prediction is stored immutably and is never changed by outcomes. Learning is analytical and auditable — no automatic rule changes from a single result.</div>
    </div><div class="card"><h3>Recorded outcomes & review</h3><div id="ocList">${outcomesList(s.outcomes)}</div></div></div>`;
  $('#ocGo').onclick = async () => {
    try {
      const r = await api(`/api/sessions/${state.sessionId}/outcome`, { method: 'POST', body: {
        outcome: $('#ocSel').value, actual_entry: $('#ocEntry').value || null, actual_exit: $('#ocExit').value || null,
        actual_pl: $('#ocPl').value || null, notes: $('#ocNotes').value || null,
      } });
      const s2 = await loadSession(true);
      $('#ocList').innerHTML = outcomesList(s2.outcomes);
    } catch (e) { alert(e.message); }
  };
}
function outcomesList(outcomes) {
  if (!outcomes?.length) return '<div class="muted">No outcomes recorded for this session.</div>';
  return outcomes.map(o => `<div class="card" style="margin-bottom:10px;background:var(--panel2)">
    <span class="badge ${o.outcome === 'WIN' ? 'ok' : o.outcome === 'LOSS' ? 'err' : 'dim'}">${esc(o.outcome)}</span>
    <span class="muted" style="font-size:12px"> ${ts(o.created_at)}</span>
    <dl class="kv"><dt>Entry/Exit/P&L</dt><dd>${fmt(o.actual_entry)} / ${fmt(o.actual_exit)} / ${fmt(o.actual_pl)}</dd></dl>
    ${o.notes ? `<div style="font-size:12px">${esc(o.notes)}</div>` : ''}
    ${o.review ? `<details><summary>Post-trade review (${o.review.findings.length} findings)</summary>
      <div class="muted" style="font-size:11px">${esc(o.review.method)}</div>
      ${list(o.review.findings.map(f => `[${f.category}] ${f.detail}`))}</details>` : ''}
  </div>`).join('');
}

/* ---------------- AI Performance ---------------- */
async function vPerformance() {
  const p = await api('/api/performance');
  const j = p.chief_judge;
  view.innerHTML = `
    <h1>AI Performance</h1>
    <div class="grid g4">
      ${stat('Total analyses', p.totals.total_analyses)}${stat('BUY', p.totals.buy)}${stat('SELL', p.totals.sell)}${stat('NO TRADE', p.totals.no_trade)}
      ${stat('WIN', p.outcomes.win)}${stat('LOSS', p.outcomes.loss)}${stat('BREAKEVEN', p.outcomes.breakeven)}${stat('SKIPPED', p.outcomes.skipped)}
    </div>
    <h2>Chief Judge — ${esc(j.metric)}</h2>
    <div class="card">
      <div class="muted" style="font-size:12px">${esc(j.definition)}</div>
      ${j.closed_outcomes ? `<dl class="kv" style="margin-top:8px"><dt>Closed outcomes</dt><dd>${j.closed_outcomes}</dd><dt>Wins / Losses</dt><dd>${j.wins} / ${j.losses}</dd><dt>Directional accuracy</dt><dd>${j.directional_accuracy_pct}% (n=${j.closed_outcomes})</dd></dl>` : '<div class="empty" style="margin-top:8px">No closed BUY/SELL outcomes yet — metric unavailable rather than fabricated.</div>'}
    </div>
    <h2>Agents</h2>
    <div class="card" style="padding:0;overflow-x:auto"><table>
      <tr><th>Agent</th><th>Runs</th><th>Completed</th><th>Failed</th><th>Agreement with final (n)</th><th>Closed-outcome sample</th></tr>
      ${p.agents.map(a => `<tr><td><b>${a.agent_number}</b> ${esc(a.agent_name)}</td><td>${a.runs}</td><td>${a.completed}</td><td>${a.failed}</td>
        <td>${a.agreement_with_final_pct !== null ? `${a.agreement_with_final_pct}% (n=${a.agreement_denominator})` : '—'}</td>
        <td>${a.closed_outcome_sample || '—'}</td></tr>`).join('')}
    </table></div>
    <div class="alert info">Metrics show their exact denominators. Small samples are not statistically meaningful and are never presented as win probability.</div>`;
}

/* ---------------- Market Data ---------------- */
async function vMarket() {
  view.innerHTML = `
    <h1>Market Data <span class="muted" style="font-size:13px">Twelve Data — live fetch, honest failures</span></h1>
    <div class="card"><div class="flex">
      <select id="mdSym" style="max-width:180px">${Object.keys(INSTR).map(s => `<option>${s}</option>`).join('')}</select>
      <select id="mdTf" style="max-width:110px">${TF.map(t => `<option ${t === '4H' ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn small" id="mdGo">Fetch</button>
    </div></div>
    <div id="mdOut" class="empty" style="margin-top:14px">Choose a symbol and fetch. Nothing is preloaded or cached as fake data.</div>`;
  $('#mdGo').onclick = async () => {
    $('#mdOut').innerHTML = '<div class="loading"><span class="spinner"></span>Fetching from Twelve Data…</div>';
    try {
      const [b, q] = $('#mdSym').value.split('/');
      const r = await api(`/api/market/${b}/${q}?tf=${$('#mdTf').value}`);
      const s = r.series;
      if (s.status !== 'OK') { $('#mdOut').innerHTML = `<div class="alert err"><b>DATA_UNAVAILABLE</b> — provider: ${esc(s.provider)}<br>Reason: ${esc(s.reason)}<br>Affected: ${esc((s.affected || []).join(', '))}</div>`; return; }
      const last = s.candles.slice(-15).reverse();
      $('#mdOut').innerHTML = `
        <div class="grid g4">
          ${stat('Latest close', s.latest.close)}${stat('Latest candle', s.latest.datetime)}
          ${stat('Source', s.source)}${stat('Fetched at', new Date(s.fetched_at).toLocaleTimeString())}
        </div>
        <div class="alert warn" style="font-size:12px">${esc(s.volume_note)}</div>
        <div class="card" style="padding:0;overflow-x:auto;margin-top:10px"><table>
          <tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume (${esc(s.volume_type)})</th></tr>
          ${last.map(c => `<tr><td>${esc(c.datetime)}</td><td>${c.open}</td><td>${c.high}</td><td>${c.low}</td><td>${c.close}</td><td>${c.volume ?? '—'}</td></tr>`).join('')}
        </table></div>`;
    } catch (e) { $('#mdOut').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  };
}

/* ---------------- News ---------------- */
async function vNews() {
  view.innerHTML = `
    <h1>News <span class="muted" style="font-size:13px">News API — only articles the API actually returned</span></h1>
    <div class="card"><div class="flex">
      <select id="nwSym" style="max-width:180px">${Object.keys(INSTR).map(s => `<option>${s}</option>`).join('')}</select>
      <button class="btn small" id="nwGo">Fetch news</button></div></div>
    <div id="nwOut" class="empty" style="margin-top:14px">Fetch to load current news.</div>`;
  $('#nwGo').onclick = async () => {
    $('#nwOut').innerHTML = '<div class="loading"><span class="spinner"></span>Fetching…</div>';
    try {
      const r = await api(`/api/news?symbol=${encodeURIComponent($('#nwSym').value)}`);
      if (r.status !== 'OK') { $('#nwOut').innerHTML = `<div class="alert err"><b>DATA_UNAVAILABLE</b> — ${esc(r.reason)}</div>`; return; }
      $('#nwOut').innerHTML = `
        <div class="muted" style="font-size:12px">Query terms: ${r.query_terms.map(esc).join(', ')} · fetched ${ts(r.fetched_at)} · ${r.articles.length} articles</div>
        ${r.articles.map(a => `<div class="card" style="margin-top:10px">
          <b>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(a.headline)}</a>` : esc(a.headline)}</b>
          <div class="muted" style="font-size:12px">${esc(a.source || 'unknown source')} · ${ts(a.published_at)}</div>
          ${a.description ? `<div style="font-size:13px;margin-top:4px">${esc(a.description)}</div>` : ''}
        </div>`).join('') || '<div class="empty">API returned zero articles for these terms.</div>'}`;
    } catch (e) { $('#nwOut').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  };
}

/* ---------------- Macro ---------------- */
async function vMacro() {
  view.innerHTML = `<h1>Macro <span class="muted" style="font-size:13px">FRED — official series with publication lag, not live prices</span></h1>
    <div id="mcOut"><div class="loading"><span class="spinner"></span>Fetching FRED series…</div></div>`;
  try {
    const r = await api('/api/macro');
    if (r.status === 'DATA_UNAVAILABLE') { $('#mcOut').innerHTML = `<div class="alert err"><b>DATA_UNAVAILABLE</b> — ${esc(r.reason)}</div>`; return; }
    $('#mcOut').innerHTML = `
      <div class="muted" style="font-size:12px">${esc(r.note)} · fetched ${ts(r.fetched_at)}${r.status === 'PARTIAL' ? ' · <span class="badge warn">PARTIAL — some series failed</span>' : ''}</div>
      <div class="grid g3" style="margin-top:12px">
        ${r.series.map(s => s.status === 'OK' ? `<div class="card"><div class="muted" style="font-size:11px">${esc(s.series_id)}</div><b style="font-size:13px">${esc(s.label)}</b>
          <div style="font-size:22px;font-weight:700;margin-top:6px">${s.latest.value}</div>
          <div class="muted" style="font-size:12px">as of ${esc(s.latest.date)}${s.previous ? ` · prev ${s.previous.value} (${esc(s.previous.date)})` : ''}</div></div>`
        : `<div class="card"><b style="font-size:13px">${esc(s.label)}</b><div class="alert err" style="font-size:12px;margin-top:8px">DATA_UNAVAILABLE: ${esc(s.reason)}</div></div>`).join('')}
      </div>`;
  } catch (e) { $('#mcOut').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

/* ---------------- API Health ---------------- */
const PROVIDER_LABELS = { nvidia: 'NVIDIA', openrouter: 'OpenRouter', gemini: 'Google Gemini', 'minimax-direct': 'MiniMax (direct)', twelvedata: 'Twelve Data', fred: 'FRED', newsapi: 'News API' };
async function vHealth() {
  const last = await api('/api/health/last');
  view.innerHTML = `
    <h1>API Health</h1>
    <div class="flex"><button class="btn" id="hcGo">Run live health check (real requests)</button>
    <span class="muted" style="font-size:12px">A provider is never marked connected just because a key exists. Keys are never displayed.</span></div>
    <div id="hcOut" style="margin-top:14px">${healthTable(last, true)}</div>`;
  $('#hcGo').onclick = async () => {
    $('#hcOut').innerHTML = '<div class="loading"><span class="spinner"></span>Testing every provider with real requests…</div>';
    try { $('#hcOut').innerHTML = healthTable(await api('/api/health/check', { method: 'POST' }), false); }
    catch (e) { $('#hcOut').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  };
}
function healthTable(data, cached) {
  const rows = Object.keys(PROVIDER_LABELS).map(k => {
    const r = data.providers?.[k];
    if (!r || (cached && !r.last_check && r.configured === undefined)) return `<tr><td><b>${PROVIDER_LABELS[k]}</b></td><td colspan="6"><span class="badge dim">NOT TESTED YET</span></td></tr>`;
    const b = v => v === true || v === 1 ? '<span class="badge ok">YES</span>' : v === false || v === 0 ? '<span class="badge err">NO</span>' : '<span class="badge dim">—</span>';
    const status = r.status || (r.configured === 0 ? 'NOT CONFIGURED' : null);
    return `<tr>
      <td><b>${PROVIDER_LABELS[k]}</b></td>
      <td>${status ? `<span class="badge ${status === 'PASS' ? 'ok' : status === 'FAIL' ? 'err' : 'dim'}">${esc(status)}</span>` : '—'}</td>
      <td>${b(r.configured)}</td><td>${b(r.reachable)}</td><td>${b(r.auth_valid)}</td>
      <td>${r.model_valid === null || r.model_valid === undefined ? '<span class="badge dim">n/a</span>' : b(r.model_valid)}</td>
      <td style="font-size:12px">${r.latency_ms ? r.latency_ms + 'ms' : '—'}<br><span class="muted">${esc(r.last_success ? 'last ok: ' + ts(r.last_success) : '')}</span>
        ${r.error || r.last_error ? `<div style="color:var(--sell)">${esc(r.error || r.last_error)}</div>` : ''}${r.detail ? `<div class="muted">${esc(r.detail)}</div>` : ''}</td>
    </tr>`;
  }).join('');
  return `
    ${data.test_mode ? '<div class="alert warn"><b>TEST MODE enabled</b> — live analysis is disabled; LLM calls return labelled mock data.</div>' : ''}
    <div class="card" style="padding:0;overflow-x:auto"><table>
      <tr><th>Provider</th><th>Status</th><th>Configured</th><th>Reachable</th><th>Auth valid</th><th>Model/endpoint valid</th><th>Latency / detail</th></tr>${rows}
    </table></div>
    <h2>Secrets (values never shown)</h2>
    <div class="card" style="padding:0"><table>${Object.entries(data.secrets).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${v === 'CONFIGURED' ? '<span class="badge ok">CONFIGURED</span>' : '<span class="badge dim">NOT CONFIGURED</span>'}</td></tr>`).join('')}</table></div>
    ${cached ? '<div class="muted" style="font-size:12px;margin-top:8px">Showing last stored results. Run a live check for current status.</div>' : ''}`;
}

/* ---------------- Settings ---------------- */
async function vSettings() {
  const s = await api('/api/settings');
  const reg = s.registry;
  const slots = Object.keys(reg.routing);
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="alert info">API keys are configured ONLY via server-side environment variables (<code>.env</code>). This screen never shows or accepts key values.</div>
    <h2>Secrets status</h2>
    <div class="card" style="padding:0"><table>${Object.entries(s.secrets).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${v === 'CONFIGURED' ? '<span class="badge ok">CONFIGURED</span>' : '<span class="badge dim">NOT CONFIGURED</span>'}</td></tr>`).join('')}</table></div>
    <h2>Model registry & agent routing</h2>
    <div class="grid g2">
      <div class="card">
        <h3>Models</h3>
        <div class="muted" style="font-size:12px">Enable a model and set a real model id. Use “Load provider models” to fetch the provider's actual list — ids are validated again before every use.</div>
        <div id="modelsList">${reg.models.map((m, i) => `
          <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:10px">
            <div class="flex"><b>${esc(m.key)}</b><span class="badge ${m.enabled ? 'ok' : 'dim'}">${m.enabled ? 'ENABLED' : 'DISABLED'}</span>
              ${m.supports_image ? '<span class="badge info">VISION</span>' : ''}<span class="badge dim">${esc(m.provider)}</span></div>
            <label>Model ID</label><input data-mi="${i}" data-f="model_id" value="${esc(m.model_id || '')}" placeholder="NOT CONFIGURED" />
            <div class="flex" style="margin-top:8px">
              <label style="margin:0"><input type="checkbox" data-mi="${i}" data-f="enabled" ${m.enabled ? 'checked' : ''} style="width:auto" /> enabled</label>
              <label style="margin:0"><input type="checkbox" data-mi="${i}" data-f="supports_image" ${m.supports_image ? 'checked' : ''} style="width:auto" /> vision</label>
              <button class="btn small ghost" data-prov="${esc(m.provider)}" data-modelbtn>Load provider models</button>
            </div>
            <div class="muted" data-provlist="${esc(m.provider)}" style="font-size:11px;margin-top:6px"></div>
          </div>`).join('')}</div>
      </div>
      <div class="card">
        <h3>Agent routing</h3>
        <div class="muted" style="font-size:12px">Which model runs each slot. Vision-required agents send the screenshot only to vision-capable models.</div>
        ${slots.map(slot => `<label>${esc(slot)}</label>
          <select data-slot="${esc(slot)}">${reg.models.map(m => `<option value="${esc(m.key)}" ${reg.routing[slot].model_key === m.key ? 'selected' : ''}>${esc(m.key)} (${esc(m.provider)}${m.model_id ? ` · ${m.model_id}` : ' · NOT CONFIGURED'})</option>`).join('')}</select>`).join('')}
      </div>
    </div>
    <div style="margin-top:14px" class="flex">
      <button class="btn" id="saveReg">Save registry</button>
      <span id="saveOut" class="muted" style="font-size:12px"></span>
    </div>
    <h2>Raw registry (advanced)</h2>
    <textarea id="regRaw" class="mono" rows="14">${esc(JSON.stringify(reg, null, 2))}</textarea>
    <div style="margin-top:8px"><button class="btn ghost" id="saveRaw">Save raw JSON</button></div>`;

  document.querySelectorAll('[data-modelbtn]').forEach(btn => btn.onclick = async () => {
    const prov = btn.dataset.prov;
    const out = document.querySelector(`[data-provlist="${prov}"]`);
    out.textContent = 'Fetching real model list…';
    try {
      const r = await api(`/api/settings/provider-models/${prov}`);
      out.textContent = r.status === 'OK' ? `Available (${r.models.length}): ${r.models.slice(0, 40).map(m => m.id).join(', ')}${r.models.length > 40 ? '…' : ''}` : `${r.status}: ${r.error}`;
    } catch (e) { out.textContent = e.message; }
  });
  $('#saveReg').onclick = async () => {
    document.querySelectorAll('[data-mi]').forEach(inp => {
      const m = reg.models[Number(inp.dataset.mi)];
      if (inp.type === 'checkbox') m[inp.dataset.f] = inp.checked;
      else m[inp.dataset.f] = inp.value.trim() || null;
    });
    document.querySelectorAll('[data-slot]').forEach(sel => { reg.routing[sel.dataset.slot].model_key = sel.value; });
    try { await api('/api/settings/registry', { method: 'PUT', body: reg }); $('#saveOut').textContent = 'Saved.'; }
    catch (e) { $('#saveOut').textContent = `Error: ${e.message}`; }
  };
  $('#saveRaw').onclick = async () => {
    try { await api('/api/settings/registry', { method: 'PUT', body: JSON.parse($('#regRaw').value) }); alert('Saved.'); navigate(); }
    catch (e) { alert(e.message); }
  };
}

/* ---------------- boot ---------------- */
$('#themeToggle').onclick = () => {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  localStorage.setItem('ak_theme', next);
};
document.documentElement.dataset.theme = localStorage.getItem('ak_theme') || 'dark';
api('/api/health/last').then(d => { if (d.test_mode) $('#testModeBadge').classList.remove('hidden'); }).catch(() => {});
renderSessionBar();
if (state.sessionId) loadSession().catch(() => setSession(null));
navigate();
