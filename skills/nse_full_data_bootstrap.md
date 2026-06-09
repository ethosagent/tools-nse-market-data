# nse_full_data_bootstrap

Prepare the NSE market database from scratch or refresh it deeply enough for reliable scans, breadth, regime analysis, and morning briefs.

## Purpose

Use this skill when the user wants a full historical market-data setup for Indian markets, including:

- all NSE stock OHLCV history
- all major NSE index OHLCV history
- indicator computation for the full universe
- market state and sector state generation
- scan refresh
- final readiness validation

This skill exists to avoid partial or out-of-order data preparation.

## When to use

Use this skill when the user says things like:

- "bootstrap NSE data"
- "fill all market data"
- "prepare all stocks and indexes"
- "backfill everything"
- "initialize the market database"
- "make market brief fully ready"
- "load all historical NSE data"

## When NOT to use

Do not use this skill for:
- a normal daily refresh
- a single symbol update
- a small watchlist-only update
- one-off scan requests without data preparation

Use `nse_daily_refresh` instead for normal ongoing maintenance.

## Inputs

Accept these optional parameters conceptually:

- `history_days` (default: `1825`)
- `stock_batch_size` (default: `1000`)
- `stock_concurrency` (default: `5`)
- `include_indexes` (default: `true`)
- `refresh_scans_after_compute` (default: `true`)
- `run_final_update` (default: `true`)
- `validate_readiness` (default: `true`)

If the user does not specify values, use the defaults.

## Required index set

When `include_indexes=true`, backfill this exact symbol set:

- `^NSEI`
- `^NSEBANK`
- `^INDIAVIX`
- `^CNX100`
- `^CNX200`
- `^CNXAUTO`
- `^CNXENERGY`
- `^CNXFMCG`
- `^CNXIT`
- `^CNXMETAL`
- `^CNXPHARMA`
- `^CNXPSUBANK`
- `^CNXREALTY`
- `^CNXSC`
- `^CRSLDX`
- `^NSEMDCP50`
- `^NSMIDCP`

Use this comma-separated string when calling the tool:

`^NSEI,^NSEBANK,^INDIAVIX,^CNX100,^CNX200,^CNXAUTO,^CNXENERGY,^CNXFMCG,^CNXIT,^CNXMETAL,^CNXPHARMA,^CNXPSUBANK,^CNXREALTY,^CNXSC,^CRSLDX,^NSEMDCP50,^NSMIDCP`

## Core rule

Always do the work in this order:

1. stock OHLCV backfill
2. index OHLCV backfill
3. full indicator computation
4. scan refresh
5. latest-date market update
6. final indicator recompute
7. validation
8. only then report brief readiness

Never compute indicators before stock + index history is substantially loaded.

## Workflow

### Step 1 — Backfill all NSE stocks in batches

Call:

```typescript
nse_market_backfill({
  symbols: "",
  days: history_days,
  from_date: "",
  limit: stock_batch_size,
  skip_synced: true,
  concurrency: stock_concurrency
})
```

Repeat this step until one of these stop conditions is met:

- processed count becomes 0
- only a stable hard-failure set remains
- inserted rows drop to 0 across a remaining unsynced batch
- subsequent retries only re-report the same failed symbols

Do not treat symbol-level failures as fatal if the rest of the universe is progressing.

### Step 2 — Backfill major indexes

Call:

```typescript
nse_market_backfill({
  symbols: "^NSEI,^NSEBANK,^INDIAVIX,^CNX100,^CNX200,^CNXAUTO,^CNXENERGY,^CNXFMCG,^CNXIT,^CNXMETAL,^CNXPHARMA,^CNXPSUBANK,^CNXREALTY,^CNXSC,^CRSLDX,^NSEMDCP50,^NSMIDCP",
  days: history_days,
  from_date: "",
  limit: 0,
  skip_synced: false,
  concurrency: stock_concurrency
})
```

This index pass is mandatory for full market-regime and sector-rotation context.

### Step 3 — Compute indicators for all symbols

Call:

```typescript
nse_compute_indicators({
  symbol: "",
  from: "",
  to: ""
})
```

This should populate:

- indicators for stocks
- indicators for indexes
- market state
- sector state

### Step 4 — Refresh scan definitions

If `refresh_scans_after_compute=true`, call:

```typescript
nse_refresh_scans()
```

### Step 5 — Pull the latest missing dates

If `run_final_update=true`, call:

```typescript
nse_market_update({
  mode: "all"
})
```

### Step 6 — Recompute indicators again

Call again:

```typescript
nse_compute_indicators({
  symbol: "",
  from: "",
  to: ""
})
```

This ensures newly updated rows are reflected in:

- indicators
- market state
- sector state
- scanable setup fields

### Step 7 — Validate readiness

Validate and summarize these categories:

**A. Universe coverage**

- total instruments in database
- symbols with OHLCV
- symbols with indicators
- unresolved failures

**B. Index coverage**

Check whether the major indexes exist and appear updated.

**C. Derived-state coverage**

Summarize:

- market state date coverage
- sector state date coverage

**D. Brief readiness**

Assess whether the database is ready for:

- regime analysis
- breadth
- sector rotation
- scan density
- morning brief

If some brief fields remain blank, say clearly whether the issue is:

- missing raw data
- missing index data
- incomplete derived data
- aggregation-layer limitation

## Output format

Respond with a concise operational report using this structure:

### Bootstrap Summary

#### Historical Data Coverage

| Metric | Value |
|---|---|
| Total instruments | ... |
| Instruments with OHLCV | ... |
| Instruments with indicators | ... |
| Unresolved failed symbols | ... |

#### Index Coverage

| Index | Status |
|---|---|
| NIFTY50 | Ready / Missing |
| BANKNIFTY | Ready / Missing |
| INDIA VIX | Ready / Missing |
| ... | ... |

#### Derived State Coverage

| Table | Rows | Start Date | End Date |
|---|---|---|---|
| market_state_daily | ... | ... | ... |
| sector_state_daily | ... | ... | ... |

#### Brief Readiness

| Component | Status |
|---|---|
| Regime | Ready / Partial / Missing |
| Breadth | Ready / Partial / Missing |
| Sector rotation | Ready / Partial / Missing |
| Scan density | Ready / Partial / Missing |
| Watchlist alerts | Ready / Partial / Missing |

#### Unresolved Issues

- ...
- ...

#### Verdict

One of:

- **Database is fully scan-ready.**
- **Database is mostly ready; a small unresolved failure set remains.**
- **Database is partially ready; derived analytics still need work.**

## Execution style

- Think like a market-data operator, not a casual assistant.
- Favor completeness, but do not loop forever.
- Treat repeated symbol-level failures as a separate bucket, not a reason to restart the whole job.
- Report clearly what is done, what failed, and what still blocks a complete market brief.
- Do not claim readiness unless stocks, indexes, indicators, and derived state have all been processed.

## Success condition

The skill succeeds when:

- stock backfill is exhausted or stabilized
- index backfill is complete
- indicators are computed
- market state exists
- sector state exists
- scans are refreshed
- latest update is applied
- final readiness is reported honestly
