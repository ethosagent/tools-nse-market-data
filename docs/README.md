# NSE Market Data — Docs

`@ethosagent/tools-nse-market-data` is an NSE India market data package for Ethos AI agents. It stores historical OHLCV in SQLite for ~500 NSE equities and indexes, computes 60+ technical indicators per stock per day, tracks market-wide breadth and sector rotation metrics, and exposes everything through Ethos MCP tools so an LLM agent can run top-down market analysis.

Data is local-first: a single SQLite file on your machine. No cloud dependency, no API key, no per-call cost.

---

## The analysis funnel

Every feature in this tool exists to serve one question at one stage of the funnel:

```
Market Regime → Sector Rotation → Stock Screening → Stock Analysis → Trade Setup
```

| Stage | Question |
|---|---|
| Market Regime | Is now a good time to be buying at all? |
| Sector Rotation | Where is institutional money flowing? |
| Stock Screening | Which stocks are setting up right now? |
| Stock Analysis | Is this specific stock worth acting on? |
| Trade Setup | What's the entry, stop, and target? |

A single `nse_market_brief` call returns data for all five stages at once.

---

## What makes this different from a screener

Most screeners show you a snapshot: today's RSI, today's volume. This tool stores sequences. An LLM agent can reason about how breadth has changed over the past 20 days, not just today's number. It can say: "Breadth has been contracting for 8 consecutive days during a price rally — this is a distribution warning." A rule-based screener cannot do that.

Other distinguishing features:

- **Raw numbers, not labels.** `rsi_14 = 68` is stored, not `"overbought"`. Every score component is a raw number. The LLM judges — no hardcoded thresholds that age poorly.
- **Delivery % from NSE bhavcopy.** This is institutional accumulation data unavailable from Yahoo Finance or most commercial screeners. High delivery % on up-volume days = institutions buying, not retail speculation.
- **Full sector index tracking.** All 17 NSE sector indexes tracked daily with RS rank, member breadth, and week-over-week rotation signal.
- **Nifty 500 universe.** 500+ equities across large, mid, and small cap. The screener runs against the full universe, not a curated 50-stock list.
- **Skills folder.** Analytical playbooks (`.md` files with `{{variable}}` placeholders) that the agent reads at invocation time. The same analytical logic applied consistently every session.
- **Scan library.** 35+ pre-built screens organized by category — breakout, momentum, setup, reversal, volume, relative strength, top performers. Each scan is a plain JSON file you can read, fork, or extend.

---

## Available Ethos tools

| Tool | What it does |
|---|---|
| `nse_market_brief` | Single call: full regime + breadth + sector + top setups snapshot |
| `nse_run_scan` | Run any named scan against the full universe or a subset |
| `nse_market_indicators` | Get indicator history for a specific symbol (up to 63 days) |
| `nse_market_screen` | Filter watchlist by indicator conditions |
| `nse_market_backfill` | Fetch OHLCV history via Yahoo Finance |
| `nse_market_update` | Incremental sync from last stored date to today |
| `nse_invoke_skill` | Execute an analytical playbook from the skills/ folder |
| `nse_watchdog` | Evaluate a condition on latest indicators and fire alert if matched |
| `nse_backtest` | Replay a screen historically with P&L and benchmark comparison |
| `nse_watchlist_add` | Add a symbol to the watchlist |
| `nse_watchlist_remove` | Remove a symbol from the watchlist |
| `nse_watchlist_show` | Show watchlist with latest prices |
| `nse_market_clean` | Wipe all stored data (use before a fresh backfill) |

---

## Docs

- [User Guide](user-guide.md) — Start here. Full workflow from market regime check to trade plan, with example prompts.
- [Indicators: Trend](indicators/trend.md) — EMAs, SMAs, MA Stack, EMA Slope
- [Indicators: Momentum](indicators/momentum.md) — RSI, MACD, ADX, Stochastic, CCI, Williams %R, PSAR
- [Indicators: Volatility & Range](indicators/volatility-range.md) — ATR, Bollinger Bands, Keltner, Donchian
- [Indicators: Volume](indicators/volume.md) — RVOL, OBV, Delivery %, Close Position Ratio
- [Indicators: Relative Strength](indicators/relative-strength.md) — RS vs Segment, RS Rank
- [Indicators: Price Levels](indicators/price-levels.md) — 52W High/Low, ATH, VWAP, EMA distances
- [Indicators: Candle Patterns](indicators/candle-patterns.md) — 16 patterns detected
- [Indicators: Stage Analysis](indicators/stage-analysis.md) — Weinstein Stage 1–4
- [Indicators: Setup Types](indicators/setup-types.md) — 11 setup classifications
- [Indicators: Scoring](indicators/scoring.md) — Sniper Score, Composite Score, TF Alignment
- [Market Breadth](market-breadth.md) — Mood Score, breadth metrics, VIX
- [Sector Analysis](sector-analysis.md) — Sector rotation, RS rank, member breadth
- [Scans](scans.md) — Full scan library (35+ screens)
