# nse_daily_refresh

Run the daily NSE market-data maintenance flow so scans, breadth, and morning brief inputs stay current without repeating a full historical bootstrap.

## Purpose

Use this skill for normal day-to-day refresh after the historical database has already been built.

This skill should:

- update latest missing OHLCV for tracked market universe
- recompute indicators
- refresh scans if needed
- summarize readiness for trading and morning brief use

## When to use

Use this skill when the user says things like:

- "refresh NSE data"
- "update market data"
- "prepare today's market"
- "run daily prep"
- "get morning-brief data ready"
- "update all and recompute indicators"

## When NOT to use

Do not use this skill when:

- the database is mostly empty
- indexes were never backfilled
- the user wants a first-time full historical setup
- breadth/regime history is not yet established

Use `nse_full_data_bootstrap` instead for first-time or major rebuild workflows.

## Workflow

### Step 1 — Update all available symbols

Call:

```typescript
nse_market_update({
  mode: "all"
})
```

This fills the gap from the last synced date to the latest available market date.

### Step 2 — Recompute indicators

Call:

```typescript
nse_compute_indicators({
  symbol: "",
  from: "",
  to: ""
})
```

This updates:

- stock indicators
- index indicators
- market state
- sector state

### Step 3 — Refresh scans

Call:

```typescript
nse_refresh_scans()
```

### Step 4 — Assess readiness

Summarize whether the system is ready for:

- scanning
- market regime analysis
- breadth analysis
- sector rotation
- morning brief generation

If important fields remain unavailable, say so explicitly.

## Output format

Respond with this structure:

### Daily Refresh Summary

#### Update Status

- symbols updated: ...
- new rows added: ...

#### Indicator Status

- symbols processed: ...
- indicator dates computed: ...
- market state dates: ...
- sector state dates: ...

#### Readiness

| Component | Status |
|---|---|
| Scans | Ready / Partial / Missing |
| Regime | Ready / Partial / Missing |
| Breadth | Ready / Partial / Missing |
| Sector rotation | Ready / Partial / Missing |
| Morning brief | Ready / Partial / Missing |

#### Verdict

One of:

- **Daily data refresh complete.**
- **Daily data refresh complete, but some brief components are still partial.**
- **Refresh ran, but data quality/readiness issues remain.**

## Execution style

- Keep it fast and operational.
- Do not run heavy historical backfills here.
- If update results suggest the database is incomplete at a structural level, recommend `nse_full_data_bootstrap`.
- Do not overstate readiness.

## Success condition

The skill succeeds when:

- latest market data is updated
- indicators are recomputed
- scans are refreshed
- readiness is summarized clearly
