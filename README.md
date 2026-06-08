# tools-nse-market-data

[![npm](https://img.shields.io/npm/v/@ethosagent/tools-nse-market-data.svg)](https://www.npmjs.com/package/@ethosagent/tools-nse-market-data)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

NSE India market data tools for [Ethos AI agents](https://github.com/MiteshSharma/ethos).

Stores historical OHLCV data locally in SQLite (pure WASM — no native compilation), syncs from Yahoo Finance and NSE Bhavcopy, manages watchlists, runs screener scans, computes 60+ technical indicators, and provides market/sector breadth analysis — all from your local machine, no cloud dependency.

---

## What it does

- **Seed database** — ships pre-built 5-year OHLCV + indicators, ready on `npm install`
- **Backfill** — download up to 5 years of daily OHLCV for all NSE stocks
- **Daily sync** — fill the gap from last stored date to today
- **Watchlist** — track a curated set of symbols
- **40 built-in scans** — momentum, breakout, reversal, relative strength, setups, volume
- **60+ indicators** — RSI, EMA, SMA, MACD, ADX, Bollinger, Keltner, Stochastic, PSAR, OBV, and more
- **Market & sector state** — breadth metrics, mood score, sector rotation
- **Backtesting** — historical screen replay with P&L analysis
- **FII/DII flows** — institutional buy/sell data from NSE
- **Corporate actions** — dividends, splits, bonus
- **Bulk/block deals** — large institutional trades
- **Ethos tools** — exposes `createNseMarketDataTools()` returning `Tool[]` for agent integration

Data sources: Yahoo Finance (free, no API key) + NSE Bhavcopy (official bulk download).

---

## Quick start

```bash
npm install @ethosagent/tools-nse-market-data

# Full initialization: instruments + 5-year backfill + indicators
nse-market-data init --years 5

# Or step by step:
nse-market-data watchlist add RELIANCE.NS
nse-market-data backfill --symbols RELIANCE.NS
nse-market-data compute-indicators
nse-market-data history RELIANCE.NS --days 10
nse-market-data scan momentum_surge
```

---

## Run locally (development)

```bash
npm install
npm run build

# Use a throwaway DB for testing
export NSE_MARKET_DATA_DB=/tmp/test-market.db

# Full init (downloads data, computes indicators)
node dist/cli.js init --years 5

# Backfill all symbols
node dist/cli.js backfill --all --skip-synced --concurrency 10

# Mark delisted symbols inactive
node dist/cli.js backfill --all --skip-synced --mark-failed-inactive

# Compute everything
node dist/cli.js compute-indicators
node dist/cli.js compute-market-state
node dist/cli.js compute-sector-state

# Run scans
node dist/cli.js scan --list
node dist/cli.js scan momentum_surge
node dist/cli.js scan base_breakout

# Watchlist
node dist/cli.js watchlist add RELIANCE.NS
node dist/cli.js watchlist show

# History and quotes
node dist/cli.js history RELIANCE.NS --days 10
node dist/cli.js quote RELIANCE.NS

# Backtest
node dist/cli.js backtest --from 2025-01-01 --to 2025-12-31 --scan-id momentum_surge

# Institutional data
node dist/cli.js fetch-fii-dii --days 5
node dist/cli.js fetch-bulk-block
node dist/cli.js fetch-corporate-actions --symbol RELIANCE.NS
```

---

## CLI reference

### Setup & Seed

| Command | Description |
|---|---|
| `init [--years N]` | Full initialization: seed instruments + scans, backfill index + watchlist, compute indicators (default 5 years) |
| `seed-update` | Import new symbols from GitHub seed (additive) |
| `refresh-instruments` | Reload instruments + index constituents from data/ |
| `refresh-scans` | Reload scan definitions from scans/ |

### Data Sync

| Command | Description |
|---|---|
| `backfill [--symbols A,B] [--from DATE] [--all] [--skip-synced] [--concurrency N] [--mark-failed-inactive]` | Download OHLCV history |
| `backfill-status` | Show synced vs pending symbols |
| `update [--mode watchlist\|all]` | Sync from last stored date to today |

### Analysis

| Command | Description |
|---|---|
| `compute-indicators [--symbol SYM] [--from DATE] [--to DATE]` | Compute 60+ technical indicators |
| `compute-market-state [--from DATE] [--to DATE]` | Compute market breadth metrics |
| `compute-sector-state [--from DATE] [--to DATE]` | Compute sector rotation metrics |
| `scan <scan_id>` | Run a saved scan |
| `scan --list` | List all 40 built-in scans |
| `screen [--list NAME] [--volume-surge N] [--near-high N]` | Screen watchlist |
| `backtest --from DATE --to DATE [--scan-id ID] [--hold-days N]` | Backtest a scan |

### Queries

| Command | Description |
|---|---|
| `history SYMBOL [--days N]` | OHLCV history from local DB |
| `quote SYMBOL` | Live price from Yahoo Finance |

### Watchlist

| Command | Description |
|---|---|
| `watchlist add SYMBOL [--list NAME] [--notes TEXT]` | Add to watchlist |
| `watchlist remove SYMBOL [--list NAME]` | Remove from watchlist |
| `watchlist show [--list NAME]` | Show watchlist |

### Data Fetching

| Command | Description |
|---|---|
| `fetch-fii-dii [--date DATE] [--days N]` | Fetch FII/DII institutional flows |
| `fetch-corporate-actions --symbol SYM [--from DATE] [--to DATE]` | Fetch dividends, splits, bonus |
| `fetch-bulk-block [--date DATE]` | Fetch bulk and block deals |

### Maintenance

| Command | Description |
|---|---|
| `mark-inactive SYMBOL1,SYMBOL2,...` | Mark symbols as inactive |
| `detect-splits [--gap N]` | Detect potential stock splits |
| `clean` | Delete all stored data |

**Options:** `--db PATH` (override DB path) or `NSE_MARKET_DATA_DB` env var. Default: `~/.ethos/market-data/market.db`

---

## Using with Ethos

### Installation

```bash
pnpm add @ethosagent/tools-nse-market-data
```

### Register tools

```typescript
import { createNseMarketDataTools } from '@ethosagent/tools-nse-market-data';
// inside wire():
for (const tool of createNseMarketDataTools()) tools.register(tool);
```

### LLM initialization instructions

Add this to your agent's system prompt or personality config:

```
## NSE Market Data — Initialization Check

Before using any NSE market data tool (nse_run_scan, nse_market_history,
nse_market_brief, nse_invoke_skill, nse_market_indicators, nse_watchdog),
check if the database has data:

1. Call nse_market_history with symbol "RELIANCE.NS" and days 1.
   - If it returns data → DB is initialized, proceed normally.
   - If it returns empty or errors → DB needs initialization.

2. To initialize, run these tools IN ORDER:
   a. nse_market_backfill with days: 1825, skip_synced: true, limit: 200
      — Repeat until all symbols are synced (it processes in batches).
   b. nse_compute_indicators (no args — processes everything)

   This only needs to happen once. The seed database (bundled with the
   package) should have been decompressed on install. If it wasn't,
   the backfill fetches from Yahoo Finance instead.

3. For daily updates (after initial setup), call:
   a. nse_market_update with mode "all"
   b. nse_compute_indicators

Do NOT run scans, screens, or analysis tools until indicators are computed —
they will return empty results.
```

### Tool reference

| Tool | Description |
|---|---|
| `nse_market_clean` | Wipe all stored data |
| `nse_market_backfill` | Backfill historical OHLCV (supports batched execution) |
| `nse_market_update` | Incremental sync to today |
| `nse_watchlist_add` | Add symbol to watchlist |
| `nse_watchlist_remove` | Remove from watchlist |
| `nse_watchlist_show` | Show watchlist with prices |
| `nse_market_history` | Get OHLCV rows for a symbol |
| `nse_market_screen` | Screener against stored data |
| `nse_run_scan` | Run a saved scan by ID |
| `nse_invoke_skill` | Invoke an analysis skill (stock_deep_analysis, trade_setup, etc.) |
| `nse_market_brief` | Comprehensive market overview |
| `nse_market_indicators` | Get technical indicators for a symbol |
| `nse_watchdog` | Alert condition checker with cooldown |
| `nse_compute_indicators` | Compute/refresh all indicators |

---

## Seed database

The npm package bundles `data/seed.db.gz` — a pre-built database with 5 years of OHLCV data and computed indicators for all active NSE symbols. On `npm install`, the postinstall script decompresses it to `~/.ethos/market-data/market.db`.

### Generating a fresh seed

```bash
make build
make seed-db    # ~2-4 hours: backfill + indicators + compress
```

This runs: refresh instruments → backfill all → compute indicators → compute market/sector state → compress → write manifest.

The seed is also uploaded to GitHub releases on `make release`, enabling `nse-market-data seed-update` to fetch newer data without upgrading the package.

---

## Database

SQLite (via `node-sqlite3-wasm` — pure WASM, no native compilation) at `~/.ethos/market-data/market.db` (WAL mode, STRICT tables):

| Table | Purpose |
|---|---|
| `instruments` | Master list of ~1,400 NSE symbols |
| `ohlcv_daily` | Daily OHLCV rows, PK `(symbol, date)` |
| `sync_meta` | Last successful sync date per symbol |
| `watchlist` | User's tracked symbols |
| `index_constituents` | Nifty 50/500 membership |
| `indicators_daily` | 60+ computed indicators per symbol per date |
| `market_state_daily` | Market breadth and mood score |
| `sector_state_daily` | Per-sector breadth metrics |
| `saved_scans` | 40 built-in + custom screener queries |
| `ath_tracker` | All-time high tracking |
| `fii_dii_daily` | FII/DII institutional flows |
| `corporate_actions` | Dividends, splits, bonus |
| `bulk_block_deals` | Large institutional trades |

---

## Release process

```bash
make seed-db              # Generate fresh seed (optional, ~2-4 hours)
make version-bump-patch   # Bump version
git add -A && git commit -m "chore: release v0.x.y"
make release              # verify + check + build + tag + push + upload seed
make smoke                # Verify on npm (~3 min)
```

Requires `NPM_TOKEN` secret in GitHub repository settings.

---

## Contributing

```bash
git clone https://github.com/MiteshSharma/tools-nse-market-data
cd tools-nse-market-data
npm install
npm run check    # typecheck + lint + test
```

Code style: Biome (2 spaces, 100-char lines, single quotes).

---

## License

[MIT](./LICENSE) © 2026 Mitesh Sharma
