# Changelog

All notable changes to this project will be documented in this file.

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
