# Trading AI AK

Private multi-agent trading-analysis tool for **position trading in Gold & Forex**.
Not a broker. Does not place live trades. Never fabricates data.

## Architecture

10 independent specialist AI agents + 1 independent Chief Judge.

1. **Technical Structure Agent** — trend, HH/HL/LH/LL, BOS/CHoCH, S/R
2. **SMC Agent** — order blocks, breaker blocks, mitigation, displacement
3. **Liquidity Agent** — BSL/SSL, equal highs/lows, sweeps, stop hunts
4. **Price Action Agent** — candle patterns, rejection, engulfing, breakouts
5. **Volume Agent** — expansion/contraction, divergence, tick vs real volume
6. **FVG & Supply/Demand Agent** — fair value gaps, imbalances, zones
7. **Trend & Momentum Agent** — multi-TF trend, momentum, indicators (only when computable)
8. **Macro & Fundamental Agent** — rates, inflation, CB policy (FRED)
9. **News & Sentiment Agent** — headlines, impact, sentiment (News API)
10. **Position Trading & Risk Agent** — suitability, SL placement, R:R, sizing
11. **Chief Judge** (11th, independent) — evaluates evidence, contradictions, debate, risk

## Pipeline

1. **Immutable Snapshot**: upload screenshot → detect symbol/timeframe via vision → fetch market/news/macro ONCE → freeze
2. **Round 1**: 10 independent agents (each only sees the frozen snapshot, NOT each other)
3. **Round 2**: Adversarial debate (each challenge must reference a concrete claim) + contradiction engine
4. **Round 3**: Chief Judge weighs all evidence independently → BUY / SELL / NO_TRADE
5. **Outcome recording**: WIN/LOSS/BREAKEVEN/SKIPPED stored separately; original prediction is NEVER overwritten

## No-fake-data rule

- Missing API → `DATA_UNAVAILABLE` (never fabricated)
- Insufficient chart/data evidence → `NO_TRADE` (never guessed)
- Vision unavailable → chart-vision agents mark data quality `INSUFFICIENT`
- Vote percentages are **agent vote distribution** — never labeled as probability of profit

## APIs

| Provider | Purpose | Env var |
|---|---|---|
| NVIDIA (OpenAI-compatible) | LLM (default) | `NVIDIA_API_KEY` |
| OpenRouter | LLM (optional) | `OPENROUTER_API_KEY` |
| Google Gemini | Multimodal LLM | `GEMINI_API_KEY` |
| MiniMax | (routed through NVIDIA; no invented direct endpoint) | `MINIMAX_API_KEY` |
| Twelve Data | Market OHLCV | `TWELVE_DATA_API_KEY` |
| FRED | Macro series | `FRED_API_KEY` |
| News API | Financial news | `NEWS_API_KEY` |

Keys are stored in `.env.local` and used **server-side only**. They never appear in client JS, HTML, logs, or API responses.

## Run

```bash
npm install
npm run dev       # http://localhost:3000
npm run build && npm start   # production
```

## Pages

- `/` Dashboard
- `/new-analysis` Upload screenshot & run the council
- `/analysis/[id]` Agent council → Debate → Chief Judge → Trade plan
- `/history` Immutable session log + outcomes
- `/performance` Per-agent and Chief Judge metrics (denominators always shown)
- `/market-data`, `/news`, `/macro` Direct data inspection
- `/api-health` Live connectivity & auth tests for every provider (no keys displayed)
- `/settings` Model routing (vision/text/judge provider+model_id), test mode
- `/risk-calculator` Standalone R:R helper

## Security

- All keys read server-side via `process.env`
- All `fetch` calls happen from route handlers / server components (`"server-only"`)
- Image uploads validated by MIME and size (≤ 8 MB); path-safe filenames
- Chart text treated as untrusted data (cannot override system prompts)
- Audit log records provider/model/agent/latency/status — no secrets
