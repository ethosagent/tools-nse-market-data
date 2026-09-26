# Changelog

All notable changes to this project will be documented in this file.

## [0.1.37] - 2026-09-26

### Added
- **NSE index history from NSE's daily all-indices file.** Every index now comes from `ind_close_all_DDMMYYYY.csv` — one request per day for all indices, with real volume — instead of Yahoo, which had history for only a handful. 18 new indices ship in the seed (`Nifty Smallcap 50`, `Nifty MidSmallcap 400`, `NIFTY Midcap 100` as `^NSMIDCP100` — which switches on the mid-cap RS the indicators already read — and 15 sector/thematic indices).
- `index list [--available]`, `index add "<NSE name>"`, `index backfill`, `index constituents` CLI commands and the `nse_index_add` tool: add any NSE index by its official name (validated against the latest NSE file, with suggestions for a misspelling), backfill it, and attach its NSE constituent list. Constituents are replaced, not merged, and `update --mode all` refreshes lists older than 30 days.
- Per-symbol price source: `instruments.price_source` / `source_key`. A symbol without one is resolved once at backfill (Yahoo with at least half the trading days, else the NSE CM bhavcopy, else refused with the reason). A first-open migration routes existing rows: indices → NSE file, `-SM/-IV/-RR/-E1.NS` symbols → bhavcopy, the rest → Yahoo.
- `--source bhavcopy|yahoo` on `update` and `backfill` (tool param `source`), default `bhavcopy`: one CM bhavcopy per trading day serves every stock NSE lists; Yahoo only for what it does not (e.g. `.BO`). `yahoo` refreshes Yahoo's adjusted prices; bhavcopy-sourced SME/InvIT/REIT stay on the bhavcopy. Fallbacks are listed in the summary. Days with no new session are skipped with no Yahoo request.
- Progress: `update`, `backfill` and the index commands (CLI and tools) report a start line with totals per source, then a line at most every 25 symbols or 2 s, and `day k/n` lines for the file passes. Tool results are a short summary with rows per source, fallbacks, source switches and the failed list with reasons.
- `sources` CLI command; `source_switches` table recording automatic Yahoo → bhavcopy switches (after 3+ consecutive missed trading days during a `--source yahoo` run).
- NSE archive files are cached next to the database; old 404s are remembered as holidays.

### Changed
- `backfillAll`, `updateAll` and `updateWatchlist` return a `SyncSummary` (per-symbol results are in `.results`; `failed` is `{symbol, source, reason}[]`), and their progress callback receives `SyncProgress` events.
- Bhavcopy rows are stored with `adj_close = close` (raw prices). Split/bonus adjustment comes from `detect-splits`/corporate actions or a `--source yahoo` run.
- `upsertInstruments` no longer nulls a stored price source when the seed row has none.

### Fixed
- The CM bhavcopy reader failed on every real file ("unexpected end of file"); the old EQ-only fallback swallowed the error, so it never recovered a symbol.
- A write that fails with `database is locked` now names the `<db>.lock` directory to check.

## [0.1.36] - 2026-09-26

### Added
- `import-instruments --csv PATH [--report PATH] [--backfill-days N] [--batch N] [--delay-ms N] [--limit N]` CLI command and matching `nse_instrument_import` tool — add-only bulk registration from a `Symbol,Description,Sector,Industry` CSV. Each symbol is registered as `<Symbol>.NS` and backfilled (default 365 days). An already-registered symbol is skipped (`exists`) and no existing row is ever changed or deactivated; a symbol the feed rejects is not registered (`rejected`); a transient feed error is retryable (`error`). Runs in batches with a pause between them, writes a per-symbol report CSV after each batch, and resumes from that report on the next run.

### Fixed
- `nse_instrument_add` treats an empty array or an empty/whitespace string in any optional field as absent. Models fill optional fields with placeholders (`members: []`, `isin: ""`), which made every equity registration fail with "members is only valid with instrument_type: index". A non-empty `members` on an equity is still refused.

## [Unreleased]

### Added
- `nse_market_query` — run one read-only SQL `SELECT` against the local database and get JSON rows back. For questions the curated scans do not cover; `nse_run_scan` and `nse_market_screen` remain the better path for anything they already answer. Read-only connection plus a statement guard that rejects writes, `PRAGMA`, `ATTACH`, and trailing statements. Output is bounded by `limit` (default 200, max 1000) and a ~30,000-character JSON budget. There is no query timeout — an unconstrained join blocks until it completes. Lives in its own toolset, `market_query`, so a personality can hold the curated scans without holding arbitrary SQL.
- `nse_instrument_add` — register an equity or index that the seed data missed. Validates the symbol against the price feed first, and with `backfill: true` downloads history before writing the row so a typo never lands. Idempotent: an existing symbol is reported, not overwritten, unless `update: true`. Indices register through the same tool with `instrument_type: 'index'` and an optional `members` list.
- Initial project scaffold
- `MarketDataStore` class with SQLite backend
- Yahoo Finance OHLCV fetcher
- Watchlist management (add/remove/show)
- Screener (volume surge, near 52-week high)
- Technical indicators: RSI, EMA, SMA, MACD
- CLI binary (`nse-market-data`)
- Ethos tool wrappers (`createNseMarketDataTools()`)
- NSE Nifty 50 built-in symbol list

### Changed
- The instrument refresh sweep is now a soft delete. `refresh-instruments` and `init` previously ran `DELETE FROM instruments WHERE symbol NOT IN (<seed batch>)`, which destroyed any manually added instrument and orphaned its price history. It now sets `is_active = 0`. A manually added instrument survives the refresh, but comes back deactivated — the scan runner filters the universe to `is_active = 1`, so it will not appear in results until reactivated with `nse_instrument_add` and `update: true`. The `removed` count reported by both commands now counts deactivations.
