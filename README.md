# Trading AI AK

Private personal trading-analysis terminal for **position trading in gold & forex**.
A 10-agent AI council + independent Chief Judge analyzes an uploaded chart screenshot
against an **immutable frozen snapshot** of real market, news, and macro data.

> **This is NOT a broker. It places no trades. It never fabricates data.**
> When an API is unavailable it says `DATA_UNAVAILABLE` / `NOT CONFIGURED` / `ANALYSIS_UNAVAILABLE`
> instead of inventing prices, news, indicators, confidence, or results.
> `NO_TRADE` is a first-class outcome and is preferred over any unsupported BUY/SELL.

---

## Quick start

```bash
npm install
cp .env.example .env      # then edit .env and add YOUR keys (server-side only)
npm start                 # http://localhost:3000
```

Then open **Settings** to configure model IDs and **API Health** to run real provider tests.

## Secrets (server-side only — never in frontend, git, DB, or logs)

| Env var | Provider | Purpose |
|---|---|---|
| `NVIDIA_API_KEY` | NVIDIA `https://integrate.api.nvidia.com/v1` | OpenAI-compatible LLM (initial model `minimaxai/minimax-m3`) |
| `OPENROUTER_API_KEY` | OpenRouter `https://openrouter.ai/api/v1` | OpenAI-compatible LLM (model configurable) |
| `GEMINI_API_KEY` | Google Gemini | Multimodal LLM — **required for screenshot vision** (model configurable) |
| `MINIMAX_API_KEY` | MiniMax direct | Base URL intentionally NOT CONFIGURED; MiniMax is routed via NVIDIA and the actual provider is recorded in execution metadata |
| `TWELVE_DATA_API_KEY` | Twelve Data | OHLC time series & quotes |
| `FRED_API_KEY` | FRED | Macro series (never used as a live gold price) |
| `NEWS_API_KEY` | newsapi.org | Relevant news retrieval |

The UI only ever shows `CONFIGURED` / `NOT CONFIGURED` — never key values.
The registry editor actively **rejects** JSON that looks like it contains a key.

## Architecture

```
server/
  index.js                 Express app + routes (uploads, sessions, outcomes, health, settings)
  config.js                env secrets + editable model registry (data/registry.json)
  registry.default.json    default providers / models / agent routing / symbol map
  db.js                    SQLite schema (insert-only analysis artifacts) + audit log
  util.js                  safeFetch (timeout, bounded retry, rate-limit aware), JSON extraction
  providers/
    llm.js                 OpenAI-compatible + Gemini clients, model validation, TEST_MODE mocks
    marketdata.js          Twelve Data (symbol mapping, honest DATA_UNAVAILABLE)
    fred.js                FRED macro snapshot (8 series, per-series failure states)
    news.js                News API (instrument-aware query terms, real articles only)
  services/
    vision.js              screenshot inspection (symbol/timeframe detection, anti-prompt-injection)
    agents.js              10 specialist agents, standardized JSON schema + validation
    contradictions.js      deterministic contradiction engine (CONFIRMED/CONFLICTING/UNRESOLVED)
    debate.js              vote distribution + real adversarial debate exchanges
    judge.js               independent Chief Judge (16-factor evaluation, never vote-counting)
    tradeplan.js           trade plan + R:R recomputation + direction sanity warnings
    instruments.js         contract specs; position size only with complete real inputs
    health.js              REAL health probes (PASS/FAIL/NOT CONFIGURED)
    pipeline.js            session orchestration: freeze → Round 1 → votes → contradictions
                           → debate → judge → plan; real progress state throughout
public/                    dark/light trading-terminal SPA (no build step, no keys, same-origin API)
```

### Analysis flow (every Analyze click = a NEW immutable `analysis_session_id`)

1. Screenshot upload (≤8 MB, PNG/JPEG/WEBP MIME-checked) → SHA-256 hash.
2. Vision model detects symbol/timeframe. **Mismatch** (e.g. user says 4H, chart shows 15M)
   is surfaced before analysis; if you continue, the **detected** timeframe is used and stated.
3. Market data (primary + higher timeframe), news, macro fetched once and **frozen**.
4. **Round 1** — 10 agents run independently on the same frozen snapshot (no cross-talk).
5. Vote distribution computed (labelled as votes, never win-probability).
6. Contradiction engine classifies claims.
7. **Round 2** — adversarial debate: challenges must quote a concrete opposing claim.
8. **Round 3** — Chief Judge independently rules BUY / SELL / NO_TRADE with entry zone,
   structure-based SL, TP1-3, invalidations, warnings, data quality, data freshness.
9. Trade plan: R:R recomputed from actual levels; position size only when
   entry + SL + risk amount + instrument spec (+ currency conversion when needed) all exist.

### Database (SQLite, `data/trading-ai.db`)

`analysis_sessions`, `agent_analyses`, `agent_debates`, `contradictions`,
`final_decisions`, `trade_outcomes`, `agent_registry`, `audit_log`, `api_health`.
Analysis artifacts are insert-only; recording WIN/LOSS/BREAKEVEN/SKIPPED never mutates
the stored prediction, and post-trade review is deterministic and auditable —
no automatic rule changes from a single outcome.

## TEST MODE

`TEST_MODE=true` in `.env` enables clearly-labelled mock LLM responses and disables all
live data fetching. Sessions created in test mode are permanently flagged and badged
**TEST DATA** in the UI. Production default is `false` — no mock data ever.

## Known limitations (honest)

- All defaults route agents to the single initially-configured NVIDIA model
  (`minimaxai/minimax-m3`). True model diversity requires you to enable more models in
  Settings; capability (e.g. vision) is always prioritized over diversity.
- Screenshot analysis requires a vision-capable model (e.g. Gemini). Without one the app
  returns `IMAGE_ANALYSIS_UNAVAILABLE` and analyzes only numeric/news/macro data.
- LLM output is not mathematically deterministic; the app freezes inputs, uses low
  temperature and schema validation, and returns stored sessions unchanged, but does not
  claim provider-level determinism.
- Free tiers: Twelve Data (~8 req/min), NewsAPI (dev tier: 24h delay, 100 req/day),
  NVIDIA/OpenRouter/Gemini have their own rate limits. Failures surface as real errors.
- FX/gold volume is OTC tick/provider volume, and is labelled as such.
- Vote percentages and confidence values are **never** probabilities of profit.
