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
- **16 analysis skills** — morning brief, trade setup, stock scoring, stage analysis, market regime, sector rotation, chart rendering, and more
- **Charting** — candlestick charts with annotations, support/resistance, moving averages via mplfinance
- **Bootstrap & daily refresh skills** — automated data preparation workflows for LLM agents

Data sources: Yahoo Finance (free, no API key) + NSE Bhavcopy (official bulk download).

---

## How it works

```
                         ┌──────────────────────────────────────────┐
                         │           DATA SOURCES                   │
                         │  Yahoo Finance  ·  NSE Bhavcopy          │
                         └────────────┬─────────────────────────────┘
                                      │ backfill / update
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          OHLCV (Raw Price Data)                             │
│                                                                             │
│  symbol     date        open     high     low      close    volume          │
│  ─────────  ──────────  ───────  ───────  ───────  ───────  ──────────      │
│  RELIANCE   2026-06-09  1280.00  1305.50  1275.20  1298.75  12,345,678     │
│  TCS        2026-06-09   3520.00  3548.00  3510.00  3535.00   4,567,890     │
│  INFY       2026-06-09   1480.00  1495.00  1472.00  1488.50   8,901,234     │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ compute-indicators
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      INDICATORS (60+ per symbol per day)                    │
│                                                                             │
│  Trend         │  Momentum      │  Volume        │  Position                │
│  ────────────  │  ───────────── │  ───────────── │  ─────────────           │
│  EMA 20/50/200 │  RSI (14)      │  RVOL          │  52-week high %         │
│  SMA 50/200    │  MACD          │  OBV slope     │  ATH distance           │
│  MA stack (0-4)│  ADX / DI+/DI- │  Delivery %    │  Price percentile       │
│  Stage (1-4)   │  Stochastic    │  VWAP position │  Pct from EMAs          │
│  PSAR signal   │  CCI / ROC     │  Dollar volume │  Base pattern           │
│                │                │                │                          │
│  Scores: sniper_score · composite_score · setup_type · setup_quality       │
│  Multi-TF: weekly EMA/RSI · monthly EMA · tf_alignment_score               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ scan conditions
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SCANS (40 built-in)                                │
│                                                                             │
│  Scan ID              │ Condition (WHERE clause)                            │
│  ───────────────────  │ ─────────────────────────────────────────────────── │
│  stage2_momentum      │ stage=2 AND ma_stack=4 AND rsi_14>55               │
│                       │   AND composite_score>=65                           │
│                       │                                                     │
│  52w_high_breakout    │ dist_52wk_high_pct<=1 AND rvol>=1.5                │
│                       │   AND closed_above_vwap=1                           │
│                       │                                                     │
│  momentum_surge       │ return_1m>8 AND rvol>=1.5 AND ma_stack>=3          │
│                       │   AND rsi_14>50                                     │
│                       │                                                     │
│  base_breakout        │ base_pattern IS NOT NULL AND base_depth_pct<25     │
│                       │   AND stage=2 AND near_pivot=1                      │
│                       │                                                     │
│  rs_leaders           │ rs_rank_in_segment>80 AND stage=2                  │
│                       │   AND return_3m>0                                   │
│                       │                                                     │
│  oversold_bounce      │ rsi_14<30 AND rsi_14>PREV(rsi_14)                  │
│                       │   AND close>low                                     │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ analysis / backtest
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          OUTPUT                                             │
│                                                                             │
│  Morning Brief    │  Backtest Results    │  Charts         │  Alerts        │
│  ───────────────  │  ──────────────────  │  ────────────── │  ────────────  │
│  Market regime    │  Win rate: 62%       │  Candlestick    │  52W high hit  │
│  Breadth score    │  Avg gain: +8.2%     │  MA overlays    │  Volume surge  │
│  Top 3 setups     │  Avg loss: -3.1%     │  Support/resist │  Stage change  │
│  Sector rotation  │  Expectancy: +3.8%   │  Buy/sell marks │  PSAR flip     │
│  Risk posture     │  Alpha vs Nifty: +5% │  Pattern labels │  Setup trigger │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Example flow: finding a Minervini-style breakout

```
RELIANCE.NS daily data (5 years)
        │
        ▼ compute-indicators
   EMA20=1290, EMA50=1260, EMA200=1180    ← all rising, price above all = MA stack 4
   RSI=62, MACD histogram positive         ← momentum confirmed
   Stage=2, composite_score=78             ← uptrend with high quality
   base_pattern="cup_with_handle"          ← consolidation detected
   dist_52wk_high_pct=1.2%                ← near new high
   rvol=1.8                                ← volume 80% above average
        │
        ▼ stage2_momentum scan
   ✅ MATCH: stage=2 AND ma_stack=4 AND rsi_14>55 AND composite_score>=65
        │
        ▼ backtest (entry next day open, 2× ATR stop, 30-day hold)
   Entry: ₹1,299 → Exit: ₹1,412 (+8.7%) after 22 days
```

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
| `refresh-instruments` | Reload instruments + index constituents from data/. Symbols not in the seed are deactivated (`is_active = 0`), not deleted — the `removed` count is deactivations |
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
## NSE Market Data — Initialization

Before using any NSE market data tool, check if the database is ready:

1. Call nse_market_history with symbol "RELIANCE.NS" and days 1.
   - If it returns data → Go to step 3.
   - If it returns empty → Go to step 2.

2. Bootstrap the database. Tell the user to run:
   mkdir -p ~/.ethos/market-data && gunzip -k -c \
     ~/.ethos/plugins/node_modules/@ethosagent/tools-nse-market-data/data/seed.db.gz \
     > ~/.ethos/market-data/market.db
   After confirmed, continue to step 3.

3. Compute indicators. Call nse_compute_indicators with no arguments.
   - If processed > 0 → Success. Scans and analysis are ready.
   - If processed = 0 → Tell the user to run from CLI:
       nse-market-data refresh-instruments
       nse-market-data compute-indicators
     Then retry.

4. Daily updates (once per day after market close):
   a. nse_market_update with mode: "all"
   b. nse_compute_indicators with no arguments.

IMPORTANT: Do NOT run scans or analysis until indicators are computed.
```

### LLM skills for data management

| Skill | When to use | Trigger phrases |
|---|---|---|
| `nse_full_data_bootstrap` | First-time setup or major rebuild | "bootstrap NSE data", "initialize market database", "fill all market data" |
| `nse_daily_refresh` | Daily maintenance after bootstrap is done | "refresh NSE data", "update market data", "run daily prep" |

### Tool reference

| Tool | Description |
|---|---|
| `nse_market_clean` | Wipe all stored data |
| `nse_market_backfill` | Backfill historical OHLCV (supports batched execution) |
| `nse_market_update` | Incremental sync to today |
| `nse_instrument_add` | Register an equity or index the seed data missed |
| `nse_watchlist_add` | Add symbol to watchlist |
| `nse_watchlist_remove` | Remove from watchlist |
| `nse_watchlist_show` | Show watchlist with prices |
| `nse_market_history` | Get OHLCV rows for a symbol |
| `nse_market_screen` | Screener against stored data |
| `nse_run_scan` | Run a saved scan by ID |
| `nse_market_query` | Run one read-only SQL SELECT against the local database |
| `nse_invoke_skill` | Invoke an analysis skill (stock_deep_analysis, trade_setup, etc.) |
| `nse_market_brief` | Comprehensive market overview |
| `nse_market_indicators` | Get technical indicators for a symbol |
| `nse_watchdog` | Alert condition checker with cooldown |
| `nse_compute_indicators` | Compute/refresh all indicators |

#### `nse_market_query` — ad-hoc SQL

For questions nobody pre-built a scan for. Anything the scan library already covers is better answered by `nse_run_scan` or `nse_market_screen` — those encode domain judgement this tool does not.

It sits in its own toolset, `market_query`, rather than `market`, so a personality can hold the curated scans without holding arbitrary SQL.

| Argument | Default | Notes |
|---|---|---|
| `sql` | — | Required. One statement, starting with `SELECT` or `WITH`. |
| `limit` | `200` | Max 1000. Out-of-range values are clamped. |

Joining today's price row to today's indicators — the case the tool exists for:

```json
{
  "sql": "SELECT o.symbol AS symbol, n.name AS name, o.close AS close, i.rsi_14 AS rsi, i.rvol AS rvol FROM ohlcv_daily o JOIN indicators_daily i ON i.symbol = o.symbol AND i.date = o.date JOIN instruments n ON n.symbol = o.symbol WHERE o.date = (SELECT MAX(date) FROM indicators_daily) AND n.instrument_type = 'equity' AND n.is_active = 1 AND i.rvol >= 2 ORDER BY i.rvol DESC",
  "limit": 25
}
```

Returns JSON: `row_count`, `truncated`, `elapsed_ms`, `columns`, `rows`, and a `note` when the result was cut short.

Constraints:

- Read-only. The connection is opened `readOnly` with `PRAGMA query_only = 1`, and a tokenizer scrubs comments and string literals before rejecting `ATTACH`, `PRAGMA`, writes, and anything after a `;`.
- Alias every output column. Duplicate names collapse — `SELECT i.symbol, c.symbol` returns one `symbol` key.
- Output is capped three ways: the row limit, an injected `LIMIT`, and a ~30,000-character JSON budget. A truncated result without an `ORDER BY` is an arbitrary sample.
- **There is no statement timeout.** `node-sqlite3-wasm` exposes no `interrupt()`, so an unconstrained join blocks the agent until it finishes. Always constrain by date or symbol.

#### `nse_instrument_add` — register a missing instrument

Registers a symbol that already exists on the price feed. Before this tool, adding one meant editing `data/instruments.json` and re-running `refresh-instruments`.

| Argument | Default | Notes |
|---|---|---|
| `symbol` | — | Required. `RELIANCE.NS`, `TATASTEEL.BO`, or `^NSEBANK`. |
| `name` | from feed | Required when `validate` is `false`. |
| `exchange` | `NSE` | |
| `sector`, `industry`, `isin`, `market_cap_band` | — | Optional labels. `sector` is what sector scans group on. |
| `instrument_type` | `equity` | Or `index`. |
| `index_category` | — | Indices only: `broad`, `sector`, `cap_segment`, `regime`, `thematic`. |
| `members` | — | Indices only: `[{ "symbol": "TCS.NS", "weight": 8.2 }]`. Weights optional. |
| `as_of_date` | today (IST) | `YYYY-MM-DD`, stamped on constituent rows. |
| `validate` | `true` | Check the symbol against the price feed first. |
| `update` | `false` | Overwrite an existing row instead of reporting it. |
| `backfill` | `false` | Download price history immediately. |
| `backfill_days` | `365` | Ignored when `backfill` is `false`. |

```json
{ "symbol": "ZOMATO.NS", "sector": "Consumer Services", "backfill": true, "backfill_days": 1825 }
```

Then run `nse_compute_indicators` — without indicators the symbol stays invisible to `nse_run_scan`, `nse_market_screen`, and `nse_market_indicators`.

Behaviour worth knowing:

- **Idempotent.** An existing symbol reports its current values and OHLCV coverage, writes nothing, and costs zero feed calls. Pass `update: true` to overwrite.
- **Backfill runs before the write**, so a typo is caught before a row lands.
- **Validation only blocks on a definitive miss.** A feed response that positively says the symbol does not exist refuses the registration; a timeout or 5xx registers the instrument with a caveat rather than failing.
- **Indices use the same tool** — `instrument_type: "index"`. They live in `instruments`; there is no separate indices table. `members` writes to `index_constituents`, and members that are not themselves registered are attached but named back to you.

```json
{
  "symbol": "^CNXPHARMA",
  "instrument_type": "index",
  "index_category": "sector",
  "members": [{ "symbol": "SUNPHARMA.NS", "weight": 21.4 }, { "symbol": "CIPLA.NS", "weight": 8.1 }]
}
```

#### Manually added instruments and the refresh sweep

`refresh-instruments` and `init` reload `instruments` from the shipped seed JSON, then sweep every symbol that is not in that batch. A manually added symbol is never in the seed.

That sweep used to be a hard `DELETE`, which destroyed the row and orphaned its price history. It now sets `is_active = 0`. So a manually added instrument **survives** the refresh — but it comes back **deactivated**, and the scan runner filters the universe to `is_active = 1`, so it will not appear in scan results until it is reactivated.

If a symbol you added has quietly stopped showing up in scans, this is why. Re-run `nse_instrument_add` with `update: true` to set it active again.

---

## Skills

The package ships 16 analysis skills in `skills/` that guide LLM agents through structured workflows:

### Data Management
| Skill | Purpose |
|---|---|
| `nse_full_data_bootstrap` | Full historical setup: stocks → indexes → indicators → scans → validate |
| `nse_daily_refresh` | Daily update: sync → compute indicators → refresh scans → assess readiness |

### Analysis
| Skill | Purpose |
|---|---|
| `morning_brief` | Pre-market trading brief: regime, breadth, sectors, top setups, risk posture |
| `stock_deep_analysis` | Comprehensive single-stock analysis with support/resistance levels |
| `trade_setup` | Entry zone, stop loss, targets for a specific stock |
| `stock_scoring` | Composite quality scoring across multiple dimensions |
| `stage_analysis` | Weinstein stage classification and implications |
| `market_regime` | Broad market regime assessment from breadth data |
| `sector_rotation` | Sector relative strength ranking and rotation signals |
| `breadth_narrative` | Market breadth interpretation for trading decisions |
| `scan_explain` | Explain what a scan found and why it matters |
| `base_pattern_analysis` | Chart base/consolidation pattern analysis |
| `smart_money_scan` | Institutional activity detection (FII/DII + bulk/block deals) |
| `risk_check` | Position sizing and risk assessment |
| `watchdog_triage` | Alert condition evaluation with cooldown management |
| `chart_ohlcv` | Candlestick chart rendering with annotations and MA overlays |

---

## Backtesting

Run any scan over historical data to measure win rate, expectancy, and alpha. See [docs/backtesting.md](docs/backtesting.md) for the full guide.

```bash
# Backtest a built-in scan
nse-market-data backtest --scan-id stage2_momentum --from 2025-01-01 --to 2026-06-01 --hold-days 30

# Backtest a custom screen
nse-market-data backtest --screen "stage = 2 AND rsi_14 > 55 AND rvol >= 1.5" --from 2025-01-01 --to 2026-06-01
```

Output includes: per-trade detail, win rate, expectancy, max drawdown, Sharpe ratio, benchmark alpha, and by-regime breakdown.

---

## Seed database

The npm package bundles `data/seed.db.gz` — a pre-built database with 5 years of OHLCV data for all active NSE symbols (indicators are not included to keep the package under 60MB). On `npm install`, the postinstall script decompresses it to `~/.ethos/market-data/market.db`.

After install, compute indicators separately:

```bash
nse-market-data compute-indicators
nse-market-data compute-market-state
nse-market-data compute-sector-state
```

Or tell the LLM: **"Run nse_full_data_bootstrap for 5 years"**

### Generating a fresh seed

```bash
make build
make seed-db    # ~2-4 hours: backfill all OHLCV + compress (no indicators)
```

This runs: refresh instruments → refresh scans → backfill all → mark failed inactive → compress → write manifest.

The seed is also uploaded to GitHub releases on `make release`, enabling `nse-market-data seed-update` to fetch newer data without upgrading the package.

---

## Database

SQLite (via `node-sqlite3-wasm` — pure WASM, no native compilation) at `~/.ethos/market-data/market.db` (STRICT tables):

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
