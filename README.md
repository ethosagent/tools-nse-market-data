# tools-nse-market-data

[![npm](https://img.shields.io/npm/v/@ethosagent/tools-nse-market-data.svg)](https://www.npmjs.com/package/@ethosagent/tools-nse-market-data)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org/)

NSE India market data tools for [Ethos AI agents](https://github.com/MiteshSharma/ethos).

Stores historical OHLCV data locally in SQLite, syncs incrementally from Yahoo Finance, manages watchlists, runs screener queries, and computes technical indicators — all from your local machine, no cloud dependency.

---

## What it does

- **Backfill** — download 1 year of daily OHLCV for any NSE stock (e.g. `RELIANCE.NS`)
- **Daily sync** — fill the gap from last stored date to today (handles days/weeks of missed syncs)
- **Watchlist** — track a curated set of symbols
- **Screener** — SQL-powered filter: volume surge, near 52-week high, etc.
- **Indicators** — RSI, EMA, SMA, MACD computed locally from stored OHLCV rows
- **Ethos tools** — exposes `createNseMarketDataTools()` returning `Tool[]` for Ethos agent integration

Data source: Yahoo Finance (free, no API key, 15-min delayed on equity data).

---

## Quick start

```bash
npm install -g @ethosagent/tools-nse-market-data

# Add stocks to your watchlist
nse-market-data watchlist add RELIANCE.NS
nse-market-data watchlist add TCS.NS
nse-market-data watchlist add INFY.NS

# Backfill 1 year of history for watchlist symbols
nse-market-data backfill

# Update with today's data (run daily or on demand)
nse-market-data update

# See your watchlist with latest prices
nse-market-data watchlist show

# Screen for setups
nse-market-data screen --volume-surge 1.5 --near-high 5
```

---

## Run locally (development & verification)

### Step 1 — Install

```bash
npm install
```

### Step 2 — Build

```bash
npm run build
# produces: dist/index.js  dist/cli.js  dist/index.d.ts  dist/cli.d.ts
```

### Step 3 — Run all commands to verify the tool

Use `NSE_MARKET_DATA_DB=/tmp/test-market.db` to keep a throwaway database so your real data is untouched.

```bash
# -- Watchlist --
node dist/cli.js watchlist add RELIANCE.NS
node dist/cli.js watchlist add TCS.NS --notes "core holding"
node dist/cli.js watchlist add INFY.NS --list tech
node dist/cli.js watchlist show
node dist/cli.js watchlist show --list tech
node dist/cli.js watchlist remove TCS.NS
node dist/cli.js watchlist show

# -- Backfill (downloads from Yahoo Finance) --
node dist/cli.js backfill --symbols RELIANCE.NS,TCS.NS
node dist/cli.js backfill --symbols RELIANCE.NS --from 2025-01-01
# Backfill all Nifty 50 (~2 min):
node dist/cli.js backfill --all

# -- History (reads local DB — backfill first) --
node dist/cli.js history RELIANCE.NS --days 5
node dist/cli.js history RELIANCE.NS --days 30

# -- Update (gap-fill to today) --
node dist/cli.js update
node dist/cli.js update --mode all

# -- Screener --
node dist/cli.js screen
node dist/cli.js screen --volume-surge 1.5
node dist/cli.js screen --near-high 5
node dist/cli.js screen --volume-surge 1.2 --near-high 10

# -- Live quote (Yahoo Finance) --
node dist/cli.js quote RELIANCE.NS
node dist/cli.js quote TCS.NS
node dist/cli.js quote ^NSEI

# -- Clean --
node dist/cli.js clean

# -- Help --
node dist/cli.js --help
```

**Tip — use a throwaway DB for testing:**

```bash
export NSE_MARKET_DATA_DB=/tmp/test-market.db
node dist/cli.js watchlist add RELIANCE.NS
node dist/cli.js backfill --symbols RELIANCE.NS
node dist/cli.js history RELIANCE.NS --days 5
node dist/cli.js screen
```

---

## CLI reference

| Command | Description |
|---|---|
| `nse-market-data clean` | Delete all stored data |
| `nse-market-data backfill [--symbols A,B] [--from YYYY-MM-DD] [--all]` | Download historical OHLCV |
| `nse-market-data update [--mode watchlist\|all]` | Sync from last stored date to today |
| `nse-market-data watchlist add SYMBOL` | Add symbol to watchlist |
| `nse-market-data watchlist remove SYMBOL` | Remove from watchlist |
| `nse-market-data watchlist show` | Show watchlist with last close |
| `nse-market-data history SYMBOL [--days 252]` | Print OHLCV table |
| `nse-market-data screen [--volume-surge N] [--near-high N]` | Screener |
| `nse-market-data quote SYMBOL` | Live price from Yahoo Finance |

Default DB path: `~/.ethos/market-data/market.db`
Override: `NSE_MARKET_DATA_DB` env var or `--db <path>` flag.

---

## Using with Ethos

**Step 1** — install:
```bash
# In your ethos project:
pnpm add -D @ethosagent/tools-nse-market-data
```

**Step 2** — register in `packages/wiring/src/index.ts`:
```typescript
import { createNseMarketDataTools } from '@ethosagent/tools-nse-market-data';
// inside wire():
for (const tool of createNseMarketDataTools()) tools.register(tool);
```

**Step 3** — add to personality `toolset.yaml`:
```yaml
- nse_market_clean
- nse_market_backfill
- nse_market_update
- nse_watchlist_add
- nse_watchlist_remove
- nse_watchlist_show
- nse_market_history
- nse_market_screen
```

**Step 4 — First-time data setup**

After the plugin is installed, tell your agent:

> Initialize my NSE market data for the last 5 years and fill all indicators for this data

The agent will backfill OHLCV history for all Nifty 50 symbols and compute RSI, EMA, SMA, and MACD indicators. This takes a few minutes on first run.

Then set up a daily sync so data stays current — tell your agent:

> Set up a daily cron at 6:30 pm IST to update my NSE market data

---

## Tool reference

| Tool | Description |
|---|---|
| `nse_market_clean` | Wipe all stored data |
| `nse_market_backfill` | Backfill historical OHLCV |
| `nse_market_update` | Incremental sync to today |
| `nse_watchlist_add` | Add symbol to watchlist |
| `nse_watchlist_remove` | Remove symbol from watchlist |
| `nse_watchlist_show` | Show watchlist with prices |
| `nse_market_history` | Get OHLCV rows for a symbol |
| `nse_market_screen` | Screener against stored data |

---

## Technical indicators

Available from the package API:

```typescript
import { computeRsi, computeEma, computeSma, computeMacd } from '@ethosagent/tools-nse-market-data';

const closes = rows.map(r => r.close);
const rsi = computeRsi(closes, 14);    // Wilder's RSI
const ema20 = computeEma(closes, 20);
const macd = computeMacd(closes);       // { macd, signal, histogram }[]
```

---

## Data source

**Yahoo Finance** (unofficial API, no authentication required):
- 15-minute delayed data for NSE equities during market hours
- End-of-day data available after 15:30 IST
- NSE symbols use `.NS` suffix (e.g. `RELIANCE.NS`)
- Rate limit: 100ms between requests, retry-once on 429

**NSE Bhavcopy** (planned): Official NSE bulk download, all instruments in one file per day. Requires session cookie — scaffolded in `src/bhavcopy.ts`, not yet implemented.

---

## Database schema

SQLite at `~/.ethos/market-data/market.db` (WAL mode, STRICT tables):

| Table | Purpose |
|---|---|
| `instruments` | Master list of tracked symbols |
| `ohlcv_daily` | Daily OHLCV rows, indexed by `(symbol, date)` |
| `sync_meta` | Last successful sync date per symbol |
| `watchlist` | User's tracked symbols |

---

## Release process

1. Update `version` in `package.json`
2. Add entry to `CHANGELOG.md`
3. `git commit -am "chore: release v0.x.y"`
4. `git tag v0.x.y && git push && git push --tags`
5. GitHub Actions publishes to npm automatically

Requires `NPM_TOKEN` secret in GitHub repository settings.

---

## Contributing

```bash
git clone https://github.com/MiteshSharma/tools-nse-market-data
cd tools-nse-market-data
npm install
npm run check    # typecheck + lint + test
```

Code style: Biome (2 spaces, 100-char lines, single quotes). Run `npm run lint:fix` before committing.

---

## License

[MIT](./LICENSE) © 2026 Mitesh Sharma
