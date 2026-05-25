
# tools-nse-market-data — Build Plan

**Status:** Active
**Date:** 2026-05-24
**Goal:** Evolve from a per-symbol OHLCV store into a top-down market-analysis engine for the Ethos swing-trader personality — capable of regime detection, sector rotation, stock screening, setup classification, trade planning, and temporal reasoning that no rule-based tool can match.

**Funnel:** market regime → cap-segment leadership → sector rotation → stock selection → trade plan. Every table, metric, and skill exists to answer one stage of that funnel.

---

## Design Rules (carry through every phase)

- Store raw numeric values, never labels (`rsi_14 = 68`, not `"overbought"`). LLM judges.
- `ohlcv_daily` is immutable fact. `indicators_daily` and `*_state_daily` are recomputable — wipe and rerun.
- Source/derived separation: fixing a formula never touches the price record.
- Reconstructable from source: breadth and sector state are pure functions of stored OHLCV.
- **Skills live in `skills/` folder** as `.md` files, not in the database. They are prompt templates with `{{variable}}` placeholders. The LLM reads the file at skill invocation time.
- **Scans live in `scans/` folder** as `.json` files (name + SQL template). Seeded into `saved_scans` table on init. User can add custom scans to the folder and re-run `refresh-scans`.
- **Smart money classification is a skill, not a column.** Never store `smart_money_signal`, `smart_money_score`, or similar label columns. Store the raw inputs (`delivery_pct`, `obv_slope_5d`, `close_position_ratio`, `rvol`) and let `smart_money_scan.md` skill have the LLM judge from those. This is the design rule "store raw values, LLM judges" applied to institutional flow detection.

---

## Repository Structure

```
tools-nse-market-data/
├── src/
├── data/
│   ├── instruments.json
│   └── index_constituents.json
├── scans/
│   ├── breakout/
│   │   ├── 52w_high_breakout.json
│   │   ├── 52w_high_vol_spike.json
│   │   ├── ath_breakout.json
│   │   ├── sma200_breakout.json
│   │   ├── vwap_breakout.json
│   │   ├── donchian_breakout.json
│   │   ├── keltner_breakout.json
│   │   ├── 3m_high_breakout.json
│   │   └── stage2_entry.json
│   ├── momentum/
│   │   ├── bullish_rsi_zone.json
│   │   ├── rsi_oversold_bounce.json
│   │   ├── macd_bullish_cross.json
│   │   ├── adx_bullish_trend.json
│   │   ├── momentum_surge.json
│   │   ├── golden_cross.json
│   │   └── psar_flip_bullish.json
│   ├── setup/
│   │   ├── base_breakout.json
│   │   ├── pullback_to_ema.json
│   │   ├── high_quality_setups.json
│   │   └── stage2_momentum.json
│   ├── reversal/
│   │   ├── oversold_bounce.json
│   │   ├── bearish_exhaustion.json
│   │   ├── candle_reversal_bull.json
│   │   └── stage1_emerging.json
│   ├── volume/
│   │   ├── vol_2x_avg.json
│   │   ├── strong_money_inflow.json
│   │   ├── delivery_surge.json
│   │   ├── vol_dry_up.json
│   │   └── smart_money_candidates.json
│   ├── relative_strength/
│   │   ├── rs_leaders.json
│   │   ├── rs_improving.json
│   │   └── cap_rotation.json
│   └── top_performers/
│       ├── ytd_leaders.json
│       ├── top_3m_performers.json
│       ├── 1yr_stars.json
│       └── strong_money_inflow_30d.json
└── skills/
    ├── market_regime.md
    ├── sector_rotation.md
    ├── stock_deep_analysis.md
    ├── trade_setup.md
    ├── stock_scoring.md
    ├── risk_check.md
    ├── watchdog_triage.md
    ├── morning_brief.md
    ├── breadth_narrative.md
    ├── stage_analysis.md
    ├── scan_explain.md
    └── smart_money_scan.md
```

**Scan file format** (`scans/breakout/52w_high_breakout.json`):

```json
{
  "scan_id": "52w_high_breakout",
  "name": "52W High Breakout",
  "category": "breakout",
  "description": "New 52-week high with strong volume",
  "sql_template": "dist_52wk_high_pct <= 1 AND rvol >= 1.5 AND closed_above_vwap = 1",
  "tags": ["bullish", "momentum", "high-conviction"]
}
```

**Skill file format** — `.md` file with `# Skill:`, `## Purpose`, `## System Prompt`, `## Data Context` (with `{{variable}}` placeholders), `## Instructions`, `## Output Schema` sections.

---

## Phase 1 — Schema + Instruments Foundation

**Ship point:** database migrates cleanly; instruments table holds all NSE equities + indexes; all tables created empty; scan library seeded; ATH tracker initialized.

### 1.1 Schema Changes

**`instruments`** — add columns:

| Column | Type | Notes |
|---|---|---|
| `industry` | TEXT | Finer than sector (null for indexes) |
| `market_cap_band` | TEXT | `large` / `mid` / `small` (null for indexes) |
| `instrument_type` | TEXT NOT NULL DEFAULT `'equity'` | `equity` / `index` |
| `index_category` | TEXT | `regime` / `broad` / `cap_segment` / `sector` (null for equities) |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | 0 = delisted |
| `as_of_date` | TEXT | When static data was last refreshed |

**`ohlcv_daily`** — add columns:

| Column | Type | Notes |
|---|---|---|
| `adj_factor` | REAL | Cumulative adjustment factor |
| `delivery_qty` | INTEGER | NSE bhavcopy DELIV_QTY (null until Phase 4) |
| `delivery_pct` | REAL | `delivery_qty / volume` (null until Phase 4) |

**New tables:**

```sql
-- Index membership
CREATE TABLE IF NOT EXISTS index_constituents (
  index_symbol  TEXT NOT NULL,
  member_symbol TEXT NOT NULL,
  weight        REAL,
  as_of_date    TEXT NOT NULL,
  PRIMARY KEY (index_symbol, member_symbol)
) STRICT;

-- All-time high tracker (updated during bhavcopy ingestion)
CREATE TABLE IF NOT EXISTS ath_tracker (
  symbol     TEXT PRIMARY KEY,
  ath_price  REAL NOT NULL,
  ath_date   TEXT NOT NULL
) STRICT;

-- Named scan library (seeded from scans/ folder)
CREATE TABLE IF NOT EXISTS saved_scans (
  scan_id       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  description   TEXT,
  sql_template  TEXT NOT NULL,
  tags          TEXT,              -- JSON array
  is_builtin    INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (date('now'))
) STRICT;

-- Per-stock derived metrics (recomputable)
CREATE TABLE IF NOT EXISTS indicators_daily (
  symbol  TEXT NOT NULL,
  date    TEXT NOT NULL,
  -- columns added in Phase 2
  PRIMARY KEY (symbol, date)
) STRICT;

-- Per-session breadth + regime
CREATE TABLE IF NOT EXISTS market_state_daily (
  date TEXT PRIMARY KEY
  -- columns added in Phase 4
) STRICT;

-- Per-sector per-day
CREATE TABLE IF NOT EXISTS sector_state_daily (
  date   TEXT NOT NULL,
  sector TEXT NOT NULL,
  PRIMARY KEY (date, sector)
  -- columns added in Phase 5
) STRICT;

-- Schema version tracker
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL,
  description TEXT
) STRICT;
```

### 1.2 `refresh-scans` command

Reads all `scans/**/*.json` files. Upserts into `saved_scans`. Prints count added/updated. Called by `init` and manually after adding custom scans.

### 1.3 Instruments seed

Ship `data/instruments.json` with ~500 NSE equities + all index rows. Index rows:

| symbol | name | index_category |
|---|---|---|
| `^NSEI` | NIFTY 50 | regime |
| `^CRSLDX` | NIFTY 500 | broad |
| `^INDIAVIX` | India VIX | regime |
| `^CNX100` | NIFTY 100 | cap_segment |
| `^NSMIDCP100` | NIFTY Midcap 100 | cap_segment |
| `^CNXSC` | NIFTY Smallcap 100 | cap_segment |
| `^NSEBANK` | NIFTY Bank | sector |
| `^CNXIT` | NIFTY IT | sector |
| `^CNXAUTO` | NIFTY Auto | sector |
| `^CNXPHARMA` | NIFTY Pharma | sector |
| `^CNXFMCG` | NIFTY FMCG | sector |
| `^CNXMETAL` | NIFTY Metal | sector |
| `^CNXENERGY` | NIFTY Energy | sector |
| `^CNXREALTY` | NIFTY Realty | sector |
| `^CNXFINANCE` | NIFTY Financial Services | sector |
| `^CNXPSUBANK` | NIFTY PSU Bank | sector |
| `^CNXCAPGOODS` | NIFTY Capital Goods | sector |

Hardcoded cap band → index mapping:

```ts
const CAP_BAND_INDEX: Record<string, string> = {
  large: '^CNX100',
  mid:   '^NSMIDCP100',
  small: '^CNXSC',
};
```

### 1.4 `refresh-instruments` command

Re-reads `data/instruments.json` + `data/index_constituents.json` and upserts rows. Marks stale rows `is_active = 0`. Prints count of changes.

### Exit gate

```
make check passes
all 7 new tables created on a fresh DB
instruments table populated with equity + index seed
saved_scans seeded with full scan library from scans/ folder
ath_tracker created empty
schema_version tracking works
```

---

## Phase 2 — `indicators_daily` + Compute Command

**Ship point:** `compute-indicators` fills all columns including candle patterns, multi-timeframe alignment, VWAP, setup classification, stage analysis, and composite score via a three-pass architecture. Scan library is runnable.

### 2.1 `indicators_daily` columns (⭐ = minimum viable set)

**Trend / Moving Averages**

| Column | Notes |
|---|---|
| ⭐ `ema_20` | |
| ⭐ `ema_50` | |
| ⭐ `ema_200` | |
| `sma_50` | |
| `sma_200` | |
| `ema_100` | Needed for stock detail view |
| `ma_stack` | INTEGER 0–4: count of (price > ema20 > ema50 > ema200) |
| `ema_50_slope` | (ema50_today − ema50_10d_ago) / ema50_10d_ago |

**Momentum**

| Column | Notes |
|---|---|
| ⭐ `rsi_14` | |
| ⭐ `macd` | MACD line |
| ⭐ `macd_signal` | |
| ⭐ `macd_hist` | |
| `macd_hist_prev` | Previous day's histogram (for cross detection) |
| `adx` | ADX(14) |
| `adx_di_plus` | +DI |
| `adx_di_minus` | −DI |
| `stoch_k` | Stochastic %K(14,3) |
| `stoch_d` | Stochastic %D |
| `cci_20` | CCI(20) |
| `williams_r` | Williams %R(14) |
| `psar` | Parabolic SAR value |
| `psar_signal` | INTEGER 1=bullish (price above PSAR), −1=bearish |
| `roc_5` | Rate of change over 5 days |
| `return_1d` | % change today |
| `return_1w` | % return over 5 trading days |
| `return_1m` | % return over 21 trading days |
| `return_3m` | % return over 63 trading days |
| `return_6m` | % return over 126 trading days |
| `return_1y` | % return over 252 trading days |
| `return_ytd` | % change since Jan 1 |

**Relative Strength (hybrid)**

| Column | Notes |
|---|---|
| ⭐ `rs_vs_segment` | stock return_3m minus its cap-segment index return_3m |
| ⭐ `rs_vs_broad` | stock return_3m minus NIFTY 500 return_3m |
| ⭐ `rs_rank_in_segment` | REAL 0–100 percentile within cap band |
| `rs_rank_in_sector` | REAL 0–100 percentile within sector |

**Volatility / Range**

| Column | Notes |
|---|---|
| ⭐ `atr_14` | |
| `atr_pct` | atr_14 / close × 100 |
| ⭐ `adr_pct` | avg((high−low)/close) over 14d × 100 |
| `bb_upper` | Bollinger upper (20,2) |
| `bb_lower` | Bollinger lower |
| `bb_middle` | Bollinger middle (SMA20) |
| `bb_width` | (upper − lower) / middle |
| `bb_power` | (close − bb_lower) / (bb_upper − bb_lower) |
| `keltner_upper` | Keltner upper (EMA20 ± 2×ATR) |
| `keltner_lower` | Keltner lower |
| `donchian_upper_20` | 20-day highest high |
| `donchian_lower_20` | 20-day lowest low |

**Volume**

| Column | Notes |
|---|---|
| ⭐ `rvol` | today volume / vol_sma_20 |
| `vol_sma_20` | 20-day volume SMA |
| `avg_dollar_volume_20` | vol_sma_20 × avg_close_20d |
| `delivery_pct` | carried from ohlcv_daily |
| `delivery_ma_20` | 20-day average delivery_pct |
| `obv` | On-Balance Volume (cumulative, running total) |
| `obv_slope_5d` | (obv_today − obv_5d_ago) / abs(obv_5d_ago) — direction proxy |
| `close_position_ratio` | (close − low) / (high − low) × 100 — 0=closed at low, 100=at high |

**VWAP**

| Column | Notes |
|---|---|
| `vwap` | (high + low + close) / 3 HLC approximation |
| `closed_above_vwap` | INTEGER 1/0 |
| `vwap_distance_pct` | (close − vwap) / vwap × 100 |

**Position / Location**

| Column | Notes |
|---|---|
| ⭐ `dist_52wk_high_pct` | (high_52w − close) / high_52w × 100 |
| `dist_52wk_low_pct` | (close − low_52w) / low_52w × 100 |
| `dist_ath_pct` | (ath_price − close) / ath_price × 100 (joins ath_tracker) |
| `pct_from_ema20` | (close − ema_20) / ema_20 × 100 |
| `pct_from_ema50` | (close − ema_50) / ema_50 × 100 |
| `pct_from_ema200` | (close − ema_200) / ema_200 × 100 |
| `price_percentile_52w` | (close − low_52w) / (high_52w − low_52w) × 100 |

**Key Trading Levels (daily pivot points)**

| Column | Notes |
|---|---|
| `pivot_classic` | (high + low + close) / 3 |
| `r1_classic` | 2 × pivot − low |
| `r2_classic` | pivot + (high − low) |
| `r3_classic` | high + 2 × (pivot − low) |
| `s1_classic` | 2 × pivot − high |
| `s2_classic` | pivot − (high − low) |
| `s3_classic` | low − 2 × (high − pivot) |

**Candle Patterns**

| Column | Notes |
|---|---|
| `candle_pattern` | TEXT: `'hammer'`, `'bullish_engulf'`, `'doji'`, `'shooting_star'`, etc. NULL if none |
| `candle_confidence` | REAL 0.0–1.0 based on body/wick ratios |

Patterns to detect (1–3 daily bars): `hammer`, `inverted_hammer`, `shooting_star`, `doji`, `long_legged_doji`, `gravestone_doji`, `dragonfly_doji`, `marubozu_bull`, `marubozu_bear`, `spinning_top`, `bullish_engulf`, `bearish_engulf`, `dark_cloud_cover`, `piercing_line`, `morning_star`, `evening_star`.

**Multi-Timeframe Alignment**

| Column | Notes |
|---|---|
| `ema_20_weekly` | 20-week EMA derived from aggregated weekly bars |
| `ema_50_weekly` | 50-week EMA |
| `close_vs_ema20w` | INTEGER 1/0 |
| `close_vs_ema50w` | INTEGER 1/0 |
| `rsi_14_weekly` | RSI(14) on weekly bars |
| `macd_hist_weekly` | MACD histogram on weekly bars |
| `ema_10_monthly` | 10-month EMA derived from monthly bars |
| `close_vs_ema10m` | INTEGER 1/0 |
| `tf_alignment_score` | INTEGER 0–3: daily bullish (1pt) + weekly bullish (1pt) + monthly bullish (1pt) |
| `tf_alignment_detail` | TEXT: `'daily:1,weekly:1,monthly:0'` |

- Daily bullish = `ma_stack >= 3 AND rsi_14 > 50 AND macd_hist > 0`
- Weekly bullish = `close_vs_ema20w = 1 AND close_vs_ema50w = 1 AND rsi_14_weekly > 50`
- Monthly bullish = `close_vs_ema10m = 1 AND return_3m > 0`
- Weekly/monthly computed by aggregating `ohlcv_daily` into synthetic bars.

**Stage Analysis (Weinstein Stages)**

| Column | Notes |
|---|---|
| `stage` | INTEGER 1–4 |
| `stage_detail` | TEXT |

Stage definitions (deterministic):

- **Stage 1 (Basing)** — price within 5% of SMA200, sideways ≥10 weeks (price_percentile_52w 20–50), volume declining
- **Stage 2 (Advancing)** — price > SMA200 AND SMA200 slope positive AND ma_stack >= 3 AND price_percentile_52w > 50
- **Stage 3 (Topping)** — price > SMA200 but ma_stack ≤ 2 AND rsi_14 < 60 AND (return_1m < 0 OR bb_width contracting) — previously in Stage 2
- **Stage 4 (Declining)** — price < SMA200 AND SMA200 slope negative AND ma_stack ≤ 1

**Sniper Score (−20 to +20)**

| Column | Notes |
|---|---|
| `sniper_score` | REAL −20 to +20 |
| `sniper_verdict` | TEXT: `'Strong Buy'` / `'Buy'` / `'Watch'` / `'Avoid'` / `'Sell'` |
| `sniper_breakdown` | TEXT JSON: component scores |

Score components:

| Component | Weight | Rule |
|---|---|---|
| Trend_EMA | 3.0 | +3 if ma_stack=4, +1 if =3, −1 if =2, −3 if ≤1 |
| MACD | 2.0 | +2 if hist > 0 and rising, +1 if > 0, −1 if < 0, −2 if < 0 and falling |
| PSAR | 0.5 | +0.5 if bullish, −0.5 if bearish |
| Stage | 0.75 | +3 if stage=2, +0.75 if stage=1, −0.75 if stage=3, −2.25 if stage=4 (× weight) |
| RS_Rank | 1.5 | +1.5 if rs_rank_in_segment ≥ 75, +0.75 if ≥ 50, −0.75 if < 30 |
| Volume | 1.0 | +1.0 if rvol ≥ 1.5 AND closed_above_vwap, +0.5 if rvol ≥ 1.0, −0.5 if rvol < 0.7 |
| TF_Align | 1.0 | +1.0 per aligned timeframe (0 to +3 bonus) |

Verdict thresholds: ≥ 8 = Strong Buy, 4–8 = Buy, 0–4 = Watch, −3–0 = Avoid, < −3 = Sell.

**Composite Score 0–100**

| Column | Notes |
|---|---|
| `composite_score` | INTEGER 0–100 |
| `composite_grade` | TEXT: A/B/C/D |
| `score_breakdown` | TEXT JSON |

Formula: maps sniper_score from [−10, +20] to [0, 100] linearly, then adjusts for rs_rank_in_segment weight. A=80+, B=65–79, C=50–64, D<50.

**Setup Classification**

| Column | Notes |
|---|---|
| `setup_type` | TEXT — see taxonomy below |
| `setup_quality` | INTEGER 0–100 |
| `setup_detail` | TEXT JSON |

Setup taxonomy (deterministic rules):

| Type | Conditions |
|---|---|
| `base_breakout` | bb_width in bottom 20th pct of stock's 1Y history ≥10 days AND dist_52wk_high_pct ≤ 5 AND tf_alignment_score ≥ 2 AND stage = 2 |
| `breakout_confirmed` | dist_52wk_high_pct ≤ 0.5 AND rvol ≥ 1.5 AND closed_above_vwap = 1 AND stage = 2 |
| `pullback_to_ema20` | pct_from_ema20 BETWEEN −3 AND 0 AND tf_alignment_score ≥ 2 AND rsi_14 BETWEEN 45 AND 60 AND rvol < 1.0 AND stage = 2 |
| `pullback_to_ema50` | pct_from_ema50 BETWEEN −3 AND 0 AND close_vs_ema50w = 1 AND rsi_14 BETWEEN 40 AND 60 AND stage IN (1,2) |
| `ema200_retest` | pct_from_ema200 BETWEEN −2 AND 2 AND close_vs_ema20w = 1 AND stage IN (1,2) |
| `momentum_continuation` | ma_stack = 4 AND rsi_14 BETWEEN 55 AND 75 AND rvol ≥ 1.2 AND return_1m > 5 AND stage = 2 |
| `extended_overdue` | dist_52wk_high_pct ≤ 2 AND rsi_14 > 75 AND pct_from_ema50 > 10 AND stage = 2 |
| `oversold_bounce_candidate` | rsi_14 < 35 AND dist_52wk_low_pct ≤ 5 AND candle_pattern IN ('hammer','bullish_engulf','morning_star','dragonfly_doji') AND stage IN (1,2) |
| `stage1_basing` | stage = 1 (catch-all for Stage 1 stocks) |
| `recovering_downtrend` | ma_stack BETWEEN 1 AND 2 AND return_1m > 5 AND stage = 3 |
| `structural_downtrend` | stage = 4 |
| NULL | does not match any setup |

### 2.2 `compute-indicators` — Three-Pass Architecture

**Pass 1 (per-symbol):** Load full OHLCV history, compute all single-symbol indicators: EMAs/RSI/MACD/ATR/Stoch/CCI/Williams/PSAR/BB/Keltner/Donchian/VWAP, candle patterns, weekly/monthly aggregations and derived EMAs/RSI/MACD, pivot points, all return columns, all distance columns (joining ath_tracker), stage classification, psar_signal.

**Pass 2 (cross-sectional):** Once Pass 1 is complete for all symbols in the date range, compute `rs_rank_in_segment` and `rs_rank_in_sector` by percentile-ranking within each cap band and sector. Then compute `sniper_score`, `sniper_verdict`, `composite_score`, `composite_grade`, `score_breakdown`, `setup_type`, `setup_quality`, `setup_detail`.

**Pass 3 (ATH update):** For each symbol, check if today's high > current `ath_tracker.ath_price`. If yes, upsert `ath_tracker`.

Command signature:

```
compute-indicators [--symbol SYM] [--from DATE] [--to DATE] [--adjusted]
```

`--adjusted` flag (default true after Phase 6) uses `adj_close` instead of `close`.

### 2.3 `nse_get_quote` Ethos Tool

```ts
nse_get_quote({
  symbol: string,       // e.g. 'RELIANCE.NS'
  exchange?: 'NSE' | 'BSE'  // ignored — appended suffix handles this
})
// Returns: latest close, change_pct, volume, 52w_high, 52w_low, dist_52wk_high_pct,
//          rvol, rsi_14, stage, sniper_score, setup_type, composite_score, as_of date
// Source: indicators_daily + ohlcv_daily (EOD — not a live quote)
// Note: "current price" is the last stored close (updated by nse_market_update each day)
```

Output shape:
```json
{
  "symbol": "RELIANCE.NS",
  "as_of": "2026-05-24",
  "close": 1423.5,
  "change_pct": 1.2,
  "open": 1408.0,
  "high": 1431.0,
  "low": 1405.0,
  "volume": 8200000,
  "rvol": 1.4,
  "high_52w": 1650.0,
  "low_52w": 1180.0,
  "dist_52wk_high_pct": 13.7,
  "rsi_14": 58.3,
  "stage": 2,
  "sniper_score": 7.5,
  "sniper_verdict": "Buy",
  "setup_type": "pullback_to_ema50",
  "composite_score": 72
}
```

### 2.3a `nse_get_index` Ethos Tool

```ts
nse_get_index({
  index: 'NIFTY50' | 'BANKNIFTY' | 'MIDCAP100' | 'SENSEX' | 'NIFTYNEXT50'
       | 'NIFTYIT' | 'NIFTYPHARMA' | 'NIFTYFMCG' | 'NIFTYMETAL' | 'NIFTYENERGY'
       | 'NIFTYREALTY' | 'NIFTYFINSERVICE' | 'NIFTYPSUBANK' | 'NIFTYCAPGOODS'
       | 'NIFTY500' | 'INDIAVIX'
})
// Maps friendly name → stored Yahoo symbol (e.g. NIFTY50 → ^NSEI)
// Returns: level (close), change_pct, day_high, day_low, 52w_high, 52w_low,
//          indicators: stage, sniper_score, ema_stack, rsi_14, macd_hist
// Source: ohlcv_daily + indicators_daily for the index symbol
```

Index symbol map (hardcoded in tool):
```ts
const INDEX_MAP: Record<string, string> = {
  NIFTY50:       '^NSEI',
  BANKNIFTY:     '^NSEBANK',
  MIDCAP100:     '^NSMIDCP100',
  SENSEX:        '^BSESN',      // BSE via Yahoo
  NIFTYNEXT50:   '^CNXSC',
  NIFTYIT:       '^CNXIT',
  NIFTYPHARMA:   '^CNXPHARMA',
  NIFTYFMCG:     '^CNXFMCG',
  NIFTYMETAL:    '^CNXMETAL',
  NIFTYENERGY:   '^CNXENERGY',
  NIFTYREALTY:   '^CNXREALTY',
  NIFTYFINSERVICE: '^CNXFINANCE',
  NIFTYPSUBANK:  '^CNXPSUBANK',
  NIFTYCAPGOODS: '^CNXCAPGOODS',
  NIFTY500:      '^CRSLDX',
  INDIAVIX:      '^INDIAVIX',
};
```

### 2.4 `nse_run_scan` Ethos Tool

```ts
nse_run_scan({
  scan_id: string,      // looks up saved_scans table by ID
  date?: string,        // defaults to latest available date
  universe?: string,    // 'watchlist' | 'nifty50' | 'nifty500' | 'all' — default 'all'
  limit?: number        // default 50
})
// Returns: array of {symbol, name, sector, cap_band, close, composite_score, sniper_score, setup_type, key matching metrics}
```

### 2.4 `nse_invoke_skill` Ethos Tool

```ts
nse_invoke_skill({
  skill_id: string,     // maps to skills/{skill_id}.md
  params: object        // variables to interpolate into the prompt template
})
// Reads skill file, fetches required data from DB per skill's data requirements,
// assembles context, invokes LLM with structured system prompt,
// returns structured output
```

Data the skill loader automatically fetches per skill:

| Skill | Auto-fetched data |
|---|---|
| `market_regime` | last 20 rows of market_state_daily + current NIFTY indicators |
| `sector_rotation` | sector_state_daily for last 28 days, all sectors |
| `stock_deep_analysis` | 63 days indicators_daily for symbol + sector context + market regime |
| `trade_setup` | latest indicators_daily row + atr_14 + key levels + market regime |
| `stock_scoring` | latest indicators_daily row (all score components) |
| `risk_check` | symbol indicators + market regime + proposed entry/stop |
| `watchdog_triage` | all triggered alerts for today's watchlist |
| `morning_brief` | yesterday market_state + today sector_state + watchlist top 10 by composite_score |
| `breadth_narrative` | last 20 rows market_state_daily (all breadth columns) |
| `stage_analysis` | 90 days indicators_daily for symbol |
| `scan_explain` | scan hit indicators + market regime + sector state |

### 2.5 Skills Folder — Skill Templates

Each `.md` file structure: `# Skill: {Name}`, `## Purpose`, `## System Prompt`, `## Data Context` (with `{{variable}}` placeholders), `## Instructions`, `## Output Schema`.

Skills to create at Phase 2:

- **`market_regime.md`** — Output: regime label (Strong Bull/Moderate Bull/Neutral/Moderate Bear/Strong Bear), breadth trend direction, position_size_pct recommendation (100/75/50/25), regime_narrative (temporal reasoning comparing 5 and 20 days ago), confidence 0–100.
- **`sector_rotation.md`** — Output: rotating_into, rotating_from, rotation_theme, top_sector_for_swing.
- **`stock_deep_analysis.md`** — Output: trend_summary, momentum_summary, rs_summary, volume_summary, key_levels, stage_narrative, swing_verdict, watch_trigger. Includes note: "Smart money signal is derived from daily EOD data only (delivery %, daily volume ratio, daily candle close position, OBV trend). Treat as an end-of-day positional signal, not an intraday flow indicator."
- **`trade_setup.md`** — Output (Sniper Intelligence format): strategy_type, quality_score 0–100, entry_zone {low, high}, stop_loss (ATR-based), target_1 (1:2 R:R), target_2 (1:3 R:R), risk_reward_ratio, position_size_pct (1% risk rule), capital_required, max_risk_amount.
- **`stock_scoring.md`** — Output: scores for Trend_EMA/MACD/PSAR/Stage/RS_Rank/Volume/TF_Alignment with reading labels, total sniper_score, sniper_verdict, score_narrative.
- **`risk_check.md`** — Output: 5 risk checks (trend alignment, RVOL confirmation, ATR regime, VIX context, R:R viability) each pass/warn/fail. Overall risk_verdict (green/amber/red) and recommended_position_size_adjustment.
- **`watchdog_triage.md`** — Output: top_3 alerts ranked by conviction with reasoning, deprioritized alerts with why, market_context_note.
- **`morning_brief.md`** — Output: regime_status, regime_delta, top_rotating_sector + why, top_3_watchlist_setups with setup_type and trigger price, risk_posture, one_thing_to_watch.
- **`breadth_narrative.md`** — Output: breadth_trend, days_of_trend, divergence, historical_implication (LLM reasons from the data sequence), confidence 0–100.
- **`stage_analysis.md`** — Deep Weinstein stage analysis. Output: current stage, how long in this stage, confirming signals, stage transition trigger, optimal action.
- **`scan_explain.md`** — Explains a scan hit in context of market regime + sector rotation + setup quality. Answers: is this breakout in the right environment? Is sector supportive? Is volume real? What is the risk if wrong?
- **`smart_money_scan.md`** — Classifies stocks as ACCUMULATION / DISTRIBUTION / NEUTRAL using four EOD proxies: delivery_pct vs delivery_ma_20 (institutional delivery), rvol (unusual volume), close_position_ratio (buying/selling pressure within day's range), and obv_slope_5d (OBV trend). LLM judges — no hardcoded thresholds. Designed to be called after running the `smart_money_candidates` scan as a pre-filter (reduces input to ~50–100 stocks before LLM call). Output: two ranked lists (top accumulation, top distribution) with per-stock signal explanations.

### Exit gate

```
compute-indicators produces correct EMA/RSI/stage values (spot-checked)
sniper_score matches expected direction for known bullish/bearish stocks
rs_rank_in_segment is 0–100 percentile within cap band
nse_run_scan returns correct results for '52w_high_breakout'
nse_invoke_skill('trade_setup') returns structured JSON with entry/stop/target/R:R
make check passes
```

---

## Phase 3 — `market-brief` Tool (v0.2.0 ship point)

**Ship point:** `nse_market_brief` returns complete structured JSON covering all four funnel stages plus scan density, top setups, and skill-ready data.

### 3.1 `nse_market_brief` output shape

```json
{
  "as_of": "2026-05-24",
  "regime": {
    "nifty_close": 24350,
    "vs_ema50": 1,
    "vs_ema200": 1,
    "ema50_slope": 0.0023,
    "stage": 2,
    "sniper_score_nifty": 8.5,
    "sniper_verdict": "Buy"
  },
  "cap_rotation": {
    "large_rs_vs_broad": 1.2,
    "mid_rs_vs_broad": 3.1,
    "small_rs_vs_broad": -0.5
  },
  "top_sectors": [
    {
      "sector": "IT", "index": "^CNXIT",
      "return_1w": 2.3, "return_1m": 5.1,
      "rs_rank": 82, "pct_members_uptrend": 68.0,
      "rs_rank_change_1w": 14
    }
  ],
  "scan_density": {
    "base_breakout": 4,
    "breakout_confirmed": 2,
    "pullback_to_ema50": 11,
    "momentum_surge": 7,
    "oversold_bounce_candidate": 3
  },
  "top_setups": [
    {
      "symbol": "RELIANCE.NS",
      "setup_type": "base_breakout",
      "setup_quality": 82,
      "stage": 2,
      "sniper_score": 11.5,
      "composite_score": 78,
      "tf_alignment_score": 3,
      "candle_pattern": "doji",
      "candle_confidence": 0.71,
      "rvol": 0.5,
      "dist_52wk_high_pct": 2.1,
      "rs_rank_in_segment": 84
    }
  ],
  "watchlist_alerts": [
    {
      "symbol": "TCS.NS",
      "alert": "new 52wk high",
      "close": 3850,
      "rvol": 1.8,
      "setup_type": "breakout_confirmed",
      "sniper_score": 13.2
    }
  ]
}
```

`scan_density` counts how many stocks in the active universe match each major scan today — gives the LLM instant signal on whether the market is producing setups.

### 3.2 `init` command

```
nse-market-data init [--years N]  (default N=5)
```

Runs in order:
1. Seed instruments from `data/instruments.json`
2. Seed scan library from `scans/` folder into `saved_scans`
3. Backfill OHLCV for watchlist symbols + all index symbols via Yahoo (N years + 200-day buffer)
4. `compute-indicators` for the full range
5. Streams progress throughout

### Exit gate

```
init --years 1 completes without error on a fresh DB
nse_market_brief returns valid JSON for a non-empty watchlist
regime section reflects live ^NSEI data
scan_density section populated
top_setups list sorted by sniper_score
make check passes
publish as v0.2.0
```

---

## Phase 4 — Bhavcopy + Full-Universe Breadth

**Ship point:** `update` uses NSE bhavcopy for daily sync; `market_state_daily` populated with full breadth metrics including all Sniper Intelligence breadth signals.

### 4.1 Bhavcopy

Equity bhavcopy: downloads NSE's daily bhavcopy CSV, parses OHLCV for all equities, upserts into `ohlcv_daily`. Additionally parse `DELIV_QTY` and `TTL_TRD_QNTY` columns and store in `ohlcv_daily.delivery_qty` and `ohlcv_daily.delivery_pct`.

Index bhavcopy: NSE publishes index values in a separate file. Wire separately.

Fallback: if bhavcopy fetch fails, fall back to Yahoo per-symbol for watchlist only.

### 4.2 `market_state_daily` columns

**Index reference**

| Column | Type | Notes |
|---|---|---|
| `nifty_close` | REAL | |
| `nifty_vs_ema50` | INTEGER | 1/0 |
| `nifty_vs_ema200` | INTEGER | 1/0 |
| `nifty_ema50_slope` | REAL | |
| `nifty_stage` | INTEGER | 1–4 |
| `nifty_sniper_score` | REAL | from indicators_daily for ^NSEI |

**Classic breadth**

| Column | Type | Notes |
|---|---|---|
| `advances` | INTEGER | |
| `declines` | INTEGER | |
| `unchanged` | INTEGER | |
| `ad_ratio` | REAL | |
| `pct_above_50ma` | REAL | |
| `pct_above_200ma` | REAL | |
| `new_highs` | INTEGER | |
| `new_lows` | INTEGER | |
| `up_volume` | INTEGER | |
| `down_volume` | INTEGER | |
| `pct_up_2` | REAL | % stocks up > 2% |
| `pct_down_2` | REAL | % stocks down > 2% |

**VWAP breadth**

| Column | Notes |
|---|---|
| `pct_above_vwap` | % universe where closed_above_vwap=1 |

**Sniper Intelligence breadth metrics**

| Column | Notes |
|---|---|
| `ema_stack_bull_pct` | % stocks with ma_stack ≥ 3 |
| `ema200_breadth_pct` | % stocks with close > ema_200 |
| `ema50_breadth_pct` | % stocks with close > ema_50 |
| `macd_breadth_pct` | % stocks with macd_hist > 0 |
| `adx_trending_pct` | % stocks with adx > 25 |
| `avg_rsi` | average RSI across universe |
| `pct_oversold` | % with rsi_14 < 35 |
| `pct_overbought` | % with rsi_14 > 70 |
| `smart_money_acc_count` | stocks with rvol > 1.5 AND close > open |
| `smart_money_dist_count` | stocks with rvol > 1.5 AND close < open |
| `bull_divergence_count` | stocks with RSI higher high vs price lower high |
| `bear_divergence_count` | stocks with RSI lower high vs price higher high |
| `bb_squeeze_count` | stocks with bb_width in bottom 10th percentile |
| `gap_ups_count` | |
| `gap_downs_count` | |
| `vol_surges_count` | stocks with rvol ≥ 2.0 |
| `stage2_pct` | % universe in Stage 2 |
| `stage4_pct` | % universe in Stage 4 |
| `mood_score` | INTEGER 0–100 composite (10 inputs weighted equally) |
| `india_vix` | REAL — from ^INDIAVIX OHLCV |

`mood_score` weights: ema50_breadth (20%), ad_ratio (15%), pct_above_vwap (15%), macd_breadth (15%), ema200_breadth (10%), new_highs vs new_lows (10%), stage2_pct (10%), avg_rsi normalized (5%).

### 4.3 `compute-market-state` command

```
compute-market-state [--from DATE] [--to DATE]
```

Range-aware. Requires `indicators_daily` to exist first.

### 4.4 Extend `market-brief` with breadth

```json
"breadth": {
  "mood_score": 54,
  "pct_above_50ma": 60.2,
  "pct_above_200ma": 42.0,
  "pct_above_vwap": 40.5,
  "macd_breadth_pct": 25.1,
  "ema_stack_bull_pct": 22.3,
  "ad_ratio": 1.02,
  "new_highs": 107,
  "new_lows": 73,
  "smart_money_acc": 1036,
  "smart_money_dist": 1269,
  "stage2_pct": 28.4,
  "stage4_pct": 35.2,
  "india_vix": 14.2
}
```

### Exit gate

```
bhavcopy fetch succeeds for a known past date
update populates ohlcv_daily for all active instruments including delivery_qty/delivery_pct
compute-market-state --from 2025-01-01 --to 2025-12-31 completes
market_state_daily has one row per trading day
nse_market_brief includes breadth section with mood_score
make check passes
```

---

## Phase 5 — Sector State

**Ship point:** `sector_state_daily` populated; `market-brief` includes enriched sector rotation.

### 5.1 `sector_state_daily` columns

| Column | Notes |
|---|---|
| `sector_index_symbol` | the tracking index (e.g. `'^CNXIT'`) |
| `sector_return_1d` | REAL |
| `sector_return_1w` | REAL |
| `sector_return_1m` | REAL |
| `sector_return_3m` | REAL |
| `sector_return_6m` | REAL |
| `sector_return_ytd` | REAL |
| `rs_rank` | REAL — sector RS rank vs all other sectors (0–100) |
| `rs_rank_prev_week` | REAL — rs_rank 5 trading days ago |
| `rs_rank_delta_1w` | REAL — rs_rank − rs_rank_prev_week |
| `pct_members_uptrend` | REAL — % constituents with close > ema_50 |
| `pct_members_stage2` | REAL — % constituents in Stage 2 |
| `advances` | INTEGER |
| `declines` | INTEGER |
| `avg_member_rs` | REAL — average rs_vs_broad of all members |
| `avg_member_composite` | REAL — average composite_score of members |
| `top_stock_symbol` | TEXT — highest composite_score member today |
| `top_stock_return_1d` | REAL |
| `breadth_pct` | REAL — advances / (advances + declines) × 100 |

### 5.2 `compute-sector-state` command

Reads `indicators_daily` + `index_constituents`. Range-aware. Stores `rs_rank_prev_week` by looking up the row from 5 trading days ago before writing.

### 5.3 `market-brief` sector section (enriched)

```json
"top_sectors": [
  {
    "sector": "Capital Goods",
    "index": "^CNXCAPGOODS",
    "return_1w": 2.7,
    "return_1m": 5.5,
    "rs_rank": 88,
    "rs_rank_delta_1w": 14,
    "pct_members_uptrend": 72.0,
    "pct_members_stage2": 60.0,
    "avg_member_rs": 4.2,
    "top_stock": "ELECON",
    "rotation_signal": "improving"
  }
]
```

`rotation_signal` = `'improving'` if rs_rank_delta_1w > 5, `'deteriorating'` if < −5, `'stable'` otherwise.

### Exit gate

```
sector_state_daily has rows for all tracked sectors
top_sectors in nse_market_brief sorted by rs_rank
pct_members_uptrend matches manual spot-check for a known date
rs_rank_delta_1w shows correct week-over-week change
make check passes
```

---

## Phase 6 — Corporate Actions + Delivery Data (v0.5.0)

**Ship point:** `adj_factor` populated; `compute-indicators --adjusted` uses `adj_close`; delivery percentage fully populated; `detect-splits` command working.

- `adj_close` already exists in `ohlcv_daily`. `adj_factor` = `adj_close / close` stored on each row at fetch time.
- `delivery_qty` and `delivery_pct` added to schema in Phase 1/4. `delivery_ma_20` computed in Pass 1.
- **`detect-splits`** command: scans `ohlcv_daily` for overnight close-to-open gaps > 40%. Flags for manual review. Prints table of suspect symbols + dates + gap magnitude.
- **`compute-indicators --adjusted`** flag (default true after this phase): uses `adj_close` instead of `close` for all price-based calculations. Raw close still stored; indicators reflect economic reality.

---

## Phase 7 — Watchdog + Streaming (v0.6.0)

**Ship point:** watchdog evaluates conditions with cooldown; `watchdog_triage` skill ranks alerts; all long-running commands stream progress.

### 7.1 `nse_watchdog` Ethos Tool

```ts
nse_watchdog({
  symbol: string,
  condition: string,  // e.g. "rvol > 2 AND dist_52wk_high_pct < 3 AND setup_type = 'base_breakout'"
  cooldown_days?: number  // default 3 — suppress re-alert for N days
})
// Returns: { matched: boolean, current_values: object, last_alerted_date: string|null }
```

Condition DSL matches `saved_scans` SQL format — same parser, same fields.

### 7.2 Alert Cooldown Design

```sql
CREATE TABLE IF NOT EXISTS watchlist_alerts (
  symbol          TEXT NOT NULL,
  condition_hash  TEXT NOT NULL,    -- hash of condition string
  last_alerted    TEXT NOT NULL,
  alert_count     INTEGER DEFAULT 1,
  PRIMARY KEY (symbol, condition_hash)
) STRICT;
```

Before firing an alert, check `last_alerted`. If `date('now') − last_alerted < cooldown_days`, suppress.

### 7.3 `nse_invoke_skill('watchdog_triage')` Integration

At end of daily update run, after `compute-indicators` completes, automatically evaluate all watchlist conditions. Collect triggered alerts. Pass to `watchdog_triage` skill. Skill returns top 3 with reasoning. Emit to user via `ctx.emit`. Never more than 3 surfaced per day regardless of how many conditions fire.

### 7.4 Streaming

All long-running compute paths emit progress with `ctx.emit`:

- `compute-indicators`: per-symbol progress (symbol N of M, phase 1/2/3)
- `compute-market-state`: per-date progress
- `compute-sector-state`: per-date per-sector progress
- `nse_market_backfill`: per-symbol with estimated time remaining
- `nse_invoke_skill`: emits "Fetching data... Invoking LLM... Done" sequence

---

## Phase 8 — Backtest / Replay (v0.7.0)

**Ship point:** historical replay validates screens; benchmark-adjusted alpha calculated; Sharpe approximated.

### 8.1 `nse-market-data backtest` command

```
nse-market-data backtest \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --screen "rs_rank_in_segment >= 70 AND dist_52wk_high_pct <= 5 AND rvol >= 1.5 AND setup_type IN ('base_breakout','breakout_confirmed')" \
  --hold-days 10 \
  --stop-atr-mult 2.0 \
  --benchmark ^CRSLDX
```

Output per trade: symbol, entry_date, entry_price, exit_date, exit_price, exit_reason (stop/target/time), pnl_pct, holding_days, setup_type at entry, sniper_score at entry, regime at entry (nifty_stage).

Summary output:

```
Trades:          147
Win rate:        58.5%
Avg gain (wins): +8.3%
Avg loss:        -3.1%
Expectancy:      +3.7% per trade
Max drawdown:    -18.2%
Sharpe (approx): 1.42
Benchmark return over period: +22.1%
Screen alpha:    +31.4%
Avg hold:        8.2 trading days
```

**Regime-sliced output:** repeat summary broken down by `nifty_stage` at entry. Shows which regime the screen works best in.

### 8.2 `nse_backtest` Ethos Tool

```ts
nse_backtest({
  scan_id?: string,        // use a saved scan
  screen?: string,         // or raw SQL condition
  from: string,
  to: string,
  hold_days?: number,      // default 10
  stop_atr_mult?: number,  // default 2.0
  benchmark?: string       // default '^CRSLDX'
})
// Returns structured summary + trade list for LLM reasoning
```

LLM uses backtest output to say: "This screen has a 1.42 Sharpe in Stage 2 markets but only 0.31 in Stage 4 markets. Current regime is Stage 4. I would not deploy this screen today."

---

## Phase 9 — NSE Public API + Institutional Data (v0.8.0)

**Ship point:** FII/DII flows, corporate actions, bulk/block deals all stored locally and queryable via Ethos tools. NSE HTTP client with cookie handling is shared across all NSE API calls.

### 9.1 NSE HTTP Client (`src/nse-fetcher.ts`)

NSE's public API requires browser headers + a session cookie obtained by hitting the homepage first.

```ts
// Two-step init:
// 1. GET https://www.nseindia.com/ → capture Set-Cookie header
// 2. Use those cookies on all subsequent API calls
// Cookie cached in module-level variable with 5-min TTL before refresh

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
  'X-Requested-With': 'XMLHttpRequest',
};

// Rate limit: 500ms min between NSE API calls (stricter than Yahoo's 100ms)
// On failure: do NOT retry automatically — return error with clear message
// If cookie fetch itself fails: throw NseCookieError with guidance to retry
```

Exported functions:
```ts
export async function fetchFiiDii(date?: string): Promise<FiiDiiRow[]>
// Hits: https://www.nseindia.com/api/fiidiiTradeReact
// Parses: buyValue, sellValue per FII and DII category
// Returns array of daily rows (usually 1 for today, or more if queried for a date range)

export async function fetchCorporateActions(symbol: string, fromDate: string, toDate: string): Promise<CorporateActionRow[]>
// Hits: https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol={symbol}
// Parses: exDate, purpose (dividend/split/bonus/rights), value

export async function fetchBulkBlockDeals(date: string): Promise<BulkBlockDealRow[]>
// Hits: https://www.nseindia.com/api/block-deal  and  /api/bulk-deal
// Parses: symbol, clientName, dealType (bulk/block), quantity, price
```

### 9.2 New Tables

```sql
-- FII/DII daily institutional flows
CREATE TABLE IF NOT EXISTS fii_dii_daily (
  date      TEXT PRIMARY KEY,
  fii_buy   REAL NOT NULL,
  fii_sell  REAL NOT NULL,
  fii_net   REAL NOT NULL,   -- fii_buy - fii_sell
  dii_buy   REAL NOT NULL,
  dii_sell  REAL NOT NULL,
  dii_net   REAL NOT NULL    -- dii_buy - dii_sell
) STRICT;

-- Corporate actions: dividends, splits, bonus, rights
CREATE TABLE IF NOT EXISTS corporate_actions (
  symbol   TEXT NOT NULL,
  ex_date  TEXT NOT NULL,
  purpose  TEXT NOT NULL,    -- 'dividend' | 'split' | 'bonus' | 'rights'
  value    TEXT,             -- e.g. '5.00' for ₹5 dividend, '1:1' for split ratio
  PRIMARY KEY (symbol, ex_date, purpose)
) STRICT;

-- Bulk and block deals
CREATE TABLE IF NOT EXISTS bulk_block_deals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  client_name TEXT NOT NULL,
  deal_type   TEXT NOT NULL,    -- 'bulk' | 'block'
  trade_type  TEXT NOT NULL,    -- 'BUY' | 'SELL'
  quantity    INTEGER NOT NULL,
  price       REAL NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_bbd_date   ON bulk_block_deals (date);
CREATE INDEX IF NOT EXISTS idx_bbd_symbol ON bulk_block_deals (symbol);
```

### 9.3 New CLI Fetch Commands

```
nse-market-data fetch-fii-dii [--date YYYY-MM-DD] [--days N]
```
- Default: today only. `--days N` fetches last N days by looping over trading days.
- Upserts into `fii_dii_daily`. Prints count of rows saved.

```
nse-market-data fetch-corporate-actions --symbol SYM [--from YYYY-MM-DD] [--to YYYY-MM-DD]
```
- Default date range: last 1 year to today. Fetches and upserts into `corporate_actions`.

```
nse-market-data fetch-bulk-block [--date YYYY-MM-DD]
```
- Default: today. Fetches both bulk and block deal endpoints, merges, upserts into `bulk_block_deals`.

**Wire into daily `update` command:** after fetching OHLCV, also call `fetch-fii-dii` for today automatically. Corporate actions and bulk/block are on-demand only (not auto-fetched every day).

### 9.4 New Ethos Tools

**`nse_get_fii_dii`**

```ts
nse_get_fii_dii({
  date?: string,    // single date (defaults to latest stored row)
  days?: number     // last N days (overrides date if provided)
})
// Returns: [{ date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net }]
// Source: fii_dii_daily table (pre-fetched; does not call NSE API on demand)
```

Network capability: `{ allowedHosts: ['www.nseindia.com'] }` (for `fetch-fii-dii` CLI command only).

**`nse_get_corporate_actions`**

```ts
nse_get_corporate_actions({
  symbol: string,
  from_date?: string,   // default: 1 year ago
  to_date?: string      // default: today
})
// Returns: [{ ex_date, purpose, value }] sorted by ex_date DESC
// Source: corporate_actions table
```

**`nse_get_bulk_block`**

```ts
nse_get_bulk_block({
  date?: string,     // specific date (default: latest stored date)
  symbol?: string    // filter by symbol (optional)
})
// Returns: [{ date, symbol, client_name, deal_type, trade_type, quantity, price }]
// Source: bulk_block_deals table
```

### 9.5 Network Allowlist

Add to any Ethos personality config that uses these tools:

```yaml
safety:
  network:
    allow:
      - "https://www.nseindia.com/api/*"
```

Yahoo Finance hosts are already in the existing allowlist from earlier phases.

### Exit gate

```
fetch-fii-dii succeeds for a known past date and upserts to fii_dii_daily
nse_get_fii_dii returns rows with correct fii_net / dii_net arithmetic
fetch-corporate-actions --symbol RELIANCE.NS returns at least 1 dividend row
fetch-bulk-block for a known active trading date returns > 0 deals
nse_get_bulk_block symbol filter works correctly
make check passes
```

### Coverage summary after Phase 9

| Required capability | Covered after which phase |
|---|---|
| `get_quote` (EOD close, 52w range, indicators) | Phase 2 (`nse_get_quote`) |
| `get_history` (daily OHLCV) | existing (`nse_market_history`) |
| `get_index` (NIFTY50, BANKNIFTY, etc.) | Phase 2 (`nse_get_index`) |
| `get_fii_dii_flow` | Phase 9 (`nse_get_fii_dii`) |
| `get_corporate_actions` | Phase 9 (`nse_get_corporate_actions`) |
| `get_bulk_block_deals` | Phase 9 (`nse_get_bulk_block`) |
| `get_deliverable_volume` | Phase 4 (bhavcopy `delivery_qty`/`delivery_pct`) |
| Intraday intervals (1m/5m/15m/1h) | **Not supported** — EOD only by design |

---

## Ethos Tools — Complete Final List

| Tool | Phase | Purpose |
|---|---|---|
| `nse_market_backfill` | existing | Backfill OHLCV via Yahoo |
| `nse_market_screen` | existing | Filter watchlist (updated to use indicators_daily) |
| `nse_market_history` | existing | Daily OHLCV history for a symbol (up to 504 days) |
| `nse_get_quote` | Phase 2 | EOD quote snapshot — close, change, 52w range, indicators |
| `nse_get_index` | Phase 2 | Index snapshot by friendly name (NIFTY50, BANKNIFTY, etc.) |
| `nse_market_indicators` | Phase 2 | Get indicators_daily for symbol + date range |
| `nse_run_scan` | Phase 2 | Execute a named scan from saved_scans against full universe |
| `nse_invoke_skill` | Phase 2 | Execute a named skill from skills/ folder |
| `nse_market_brief` | Phase 3 | Full structured market briefing JSON |
| `nse_watchdog` | Phase 7 | Evaluate a condition on latest indicators_daily |
| `nse_backtest` | Phase 8 | Replay a screen historically with P&L + benchmark |
| `nse_get_fii_dii` | Phase 9 | FII/DII net flows by date range |
| `nse_get_corporate_actions` | Phase 9 | Dividends, splits, bonus, rights for a symbol |
| `nse_get_bulk_block` | Phase 9 | Bulk and block deals by date or symbol |

---

## What This Tool Does That Sniper Intelligence Cannot

1. **Temporal reasoning with stored sequences.** Every skill receives the last 20–63 days of data, not a snapshot. The LLM can reason: "Breadth has been contracting for 8 consecutive days after a 15% rally — this is the divergence pattern that preceded the Sept 2024 correction."

2. **Transparent, auditable scores.** Every component of `sniper_score` is stored in `sniper_breakdown`. Every setup classification is stored with its triggering conditions in `setup_detail`. The LLM and the user can inspect exactly why a score is 11.2 vs 3.4.

3. **Delivery volume confirmation.** NSE bhavcopy delivery data is unique to this tool. "Volume surge with 78% delivery vs 20-day average of 52%" is institutional accumulation.

4. **Stage × Regime × Sector alignment.** The `scan_explain` skill cross-checks all three layers before calling a setup actionable.

5. **Backtest feedback loop.** The `nse_backtest` tool lets the LLM say "this screen has 1.42 Sharpe in bull markets but 0.31 in bear markets — current regime is Stage 4, do not deploy."

6. **User-owned, forkable, extensible.** Skills and scans are plain text files. Any user can add `skills/my_custom_analysis.md` or `scans/my_screen.json` and it integrates immediately.

---

## Version Map

| Version | Phase | Key Deliverable |
|---|---|---|
| v0.1.x | — | Current: OHLCV + watchlist + basic screen |
| v0.2.0 | 1–3 | Instruments seed + full indicators + candle patterns + stage analysis + sniper score + setup classification + multi-TF alignment + scan library + skills folder + market-brief + get_quote + get_index |
| v0.3.0 | 4 | Bhavcopy + full breadth (all Sniper Intelligence metrics) + mood score |
| v0.4.0 | 5 | Sector state + rotation signals + enriched market-brief |
| v0.5.0 | 6 | Delivery data + adj_factor + detect-splits |
| v0.6.0 | 7 | Watchdog + triage skill + streaming progress |
| v0.7.0 | 8 | Backtest / replay + benchmark alpha + regime-sliced results |
| v0.8.0 | 9 | NSE public API client + FII/DII flows + corporate actions + bulk/block deals |
