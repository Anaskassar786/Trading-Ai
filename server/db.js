// db.js — SQLite persistence. Insert-only for analysis artifacts (immutability).
import Database from 'better-sqlite3';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const db = new Database(path.join(DATA_DIR, 'trading-ai.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS analysis_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created', -- created|running|complete|failed
  test_mode INTEGER NOT NULL DEFAULT 0,
  symbol TEXT,
  instrument_type TEXT,
  user_timeframe TEXT,
  detected_timeframe TEXT,
  detected_symbol TEXT,
  timeframe_mismatch INTEGER,
  timeframe_used TEXT,
  screenshot_path TEXT,
  screenshot_hash TEXT,
  screenshot_mime TEXT,
  risk_amount REAL,
  account_balance REAL,
  desired_profit REAL,
  snapshot_json TEXT,          -- frozen immutable snapshot (market/news/macro/data-status)
  progress_json TEXT,          -- real execution progress steps
  error TEXT
);

CREATE TABLE IF NOT EXISTS agent_analyses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES analysis_sessions(id),
  created_at TEXT NOT NULL,
  agent_number INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  status TEXT NOT NULL,        -- ok|failed|unavailable
  latency_ms INTEGER,
  result_json TEXT,            -- standardized agent schema
  error TEXT,
  UNIQUE(session_id, agent_number)
);

CREATE TABLE IF NOT EXISTS agent_debates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES analysis_sessions(id),
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL,
  challenger_agent INTEGER,
  challenged_agent INTEGER,
  claim TEXT,
  challenge TEXT,
  counterclaim TEXT,
  evidence_json TEXT,
  assessment TEXT,
  winner TEXT,
  confidence_change_json TEXT,
  provider TEXT,
  model_id TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contradictions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES analysis_sessions(id),
  created_at TEXT NOT NULL,
  topic TEXT,
  kind TEXT,                   -- CONFIRMED_FACT|CONFLICTING_CLAIM|UNRESOLVED_CLAIM
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS final_decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES analysis_sessions(id),
  created_at TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  status TEXT NOT NULL,        -- ok|failed|unavailable
  decision TEXT,               -- BUY|SELL|NO_TRADE|ANALYSIS_UNAVAILABLE
  result_json TEXT,
  trade_plan_json TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS trade_outcomes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES analysis_sessions(id),
  created_at TEXT NOT NULL,
  outcome TEXT NOT NULL,       -- WIN|LOSS|BREAKEVEN|SKIPPED
  actual_entry REAL,
  actual_exit REAL,
  actual_pl REAL,
  notes TEXT,
  review_json TEXT             -- post-trade error analysis (auditable, never mutates prediction)
);

CREATE TABLE IF NOT EXISTS agent_registry (
  agent_number INTEGER PRIMARY KEY,
  agent_name TEXT NOT NULL,
  description TEXT,
  requires_vision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  session_id TEXT,
  provider TEXT,
  model TEXT,
  agent TEXT,
  action TEXT,
  status TEXT,
  latency_ms INTEGER,
  data_source TEXT,
  data_timestamp TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS api_health (
  provider TEXT PRIMARY KEY,
  last_check TEXT,
  configured INTEGER,
  reachable INTEGER,
  auth_valid INTEGER,
  model_valid INTEGER,
  latency_ms INTEGER,
  last_success TEXT,
  last_error TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_session ON agent_analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_debate_session ON agent_debates(session_id);
CREATE INDEX IF NOT EXISTS idx_outcome_session ON trade_outcomes(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
`);

// Seed agent registry (idempotent, names are the single source of truth).
const AGENTS = [
  [1, 'Technical Structure Agent', 'Trend, HH/HL/LH/LL, BOS, CHoCH, swing structure, key S/R, continuation vs reversal.', 1],
  [2, 'Smart Money Concepts Agent', 'BOS, CHoCH, order blocks, breaker blocks, mitigation, displacement, inducement, premium/discount.', 1],
  [3, 'Liquidity Agent', 'Buy/sell-side liquidity, equal highs/lows, prior highs/lows, sweeps, stop-hunts, liquidity targets.', 1],
  [4, 'Price Action Agent', 'Candle bodies/wicks, rejections, engulfing, pin bars, momentum candles, breakouts, false breakouts.', 1],
  [5, 'Volume Agent', 'Volume expansion/contraction, confirmation, divergence — only when reliable volume data exists; tick vs exchange volume clearly labelled.', 1],
  [6, 'FVG + Supply/Demand Agent', 'Fair value gaps, imbalances, supply/demand zones, mitigation, zone strength, distance from price.', 1],
  [7, 'Trend + Momentum Agent', 'Multi-timeframe trend, momentum, volatility; indicators only when actually computed from valid data.', 1],
  [8, 'Macro + Fundamental Agent', 'Rates, inflation, central banks, USD, yields, employment, CPI/PCE, FOMC — from FRED/news snapshots with source + freshness.', 0],
  [9, 'News + Sentiment Agent', 'Current relevant news sentiment and event risk — only articles actually returned by the News API.', 0],
  [10, 'Position Trading + Risk Agent', 'Position-trade suitability, entry quality, stop placement, invalidation, R:R, sizing, and whether NO_TRADE is safer.', 1],
];
const seed = db.prepare('INSERT OR IGNORE INTO agent_registry (agent_number, agent_name, description, requires_vision) VALUES (?,?,?,?)');
for (const a of AGENTS) seed.run(...a);

// Lightweight migration for pre-existing databases.
try { db.exec('ALTER TABLE agent_debates ADD COLUMN winner TEXT'); } catch { /* column exists */ }

export default db;

export function audit(entry) {
  db.prepare(`INSERT INTO audit_log (ts, session_id, provider, model, agent, action, status, latency_ms, data_source, data_timestamp, error)
              VALUES (@ts,@session_id,@provider,@model,@agent,@action,@status,@latency_ms,@data_source,@data_timestamp,@error)`)
    .run({
      ts: new Date().toISOString(),
      session_id: null, provider: null, model: null, agent: null, action: null,
      status: null, latency_ms: null, data_source: null, data_timestamp: null, error: null,
      ...sanitizeAudit(entry),
    });
}

function sanitizeAudit(e) {
  const out = { ...e };
  // Defense in depth: strip anything resembling a key from audit strings.
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string') {
      out[k] = out[k].replace(/(nvapi-[A-Za-z0-9_\-]+|sk-or-v1-[a-f0-9]+|AIza[A-Za-z0-9_\-]+|apikey=[^&\s]+|api_key=[^&\s]+|key=[^&\s]+)/gi, '[REDACTED]').slice(0, 1000);
    }
  }
  return out;
}
