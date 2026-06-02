# chart-pattern-detection

Status: Draft | Date: 2026-06-02 | Scope: New feature for @ethosagent/tools-nse-market-data

## 1. Overview

Adds MarketSmith-style base pattern recognition to the tool. Operates on weekly OHLCV
bars and detects four O'Neil base patterns: Cup with Handle, Cup (no handle), Double
Bottom, and Flat Base.

For each pattern the system computes: pivot_price, buy_range_top (pivot x 1.05),
base_start_date, base_length_weeks, base_depth_pct, base_quality_score (0-100),
and near_pivot flag (1 if close is within 5% below pivot).

Pipeline: daily OHLCV -> aggregateToWeekly() -> detectChartPattern() -> indicators_daily

## 2. Algorithm Design

### Flat Base

5-20 weeks. Total range (max_high - min_low) / max_high <= 15%. Prior advance >= 20%
required. Pivot = highest high in the base.

Quality bonuses: range <8% (+20), range 8-12% (+10), base >= 8 weeks (+10), volume
contracting vs prior period (+15), last close within 3% of pivot (+10).

### Cup with Handle

Left-side high -> 12-50% decline over 6+ weeks -> recovery to >= 90% of left high
-> optional 1-8 week handle (drift <= 12%).

Pivot = handle high (if handle) or right rim high (if no handle).

Quality bonuses: depth 20-35% (+20), handle present (+15), handle volume contracting
(+10), handle drift <= 6% (+5), symmetric shape (+10), right side volume > left side (+10).

### Double Bottom

Prior decline >= 12% to L1 -> bounce to middle peak M (>= 8% above L1) -> L2 undercuts
L1 by 0.5-5% -> recovery. Pivot = M.

Quality bonuses: undercut 1-3% (+20), L2 volume < L1 volume (+15), volume surge on
recovery (+10), depth 20-40% (+10), last close within 5% of pivot (+10).

## 3. New File: src/patterns.ts

Pure module. Imports only OhlcvRow and aggregateToWeekly() from indicators.ts.
No DB, no network.

### Types

```typescript
export type PatternName =
  | 'cup_with_handle' | 'cup_no_handle' | 'double_bottom' | 'flat_base' | 'none';

export interface BasePattern {
  pattern: PatternName;
  pivot_price: number;
  buy_range_top: number;      // pivot x 1.05
  base_start_date: string;    // YYYY-MM-DD
  base_end_date: string;
  base_length_weeks: number;
  depth_pct: number;
  quality_score: number;      // 0-100
  quality_notes: string[];
}

export interface NullPattern {
  pattern: 'none';
  pivot_price: null;
  buy_range_top: null;
  base_start_date: null;
  base_end_date: null;
  base_length_weeks: 0;
  depth_pct: 0;
  quality_score: 0;
  quality_notes: string[];
}

export type PatternResult = BasePattern | NullPattern;
```

### Constants

```typescript
const CUP_MIN_WEEKS = 6;       const CUP_MAX_WEEKS = 65;
const CUP_MIN_DEPTH = 0.12;    const CUP_MAX_DEPTH = 0.50;
const CUP_RECOVERY_THRESHOLD = 0.90;
const HANDLE_MIN_WEEKS = 1;    const HANDLE_MAX_WEEKS = 8;
const HANDLE_MAX_DRIFT = 0.12; const HANDLE_MAX_WIDTH_RATIO = 0.50;
const DB_MIN_WEEKS = 7;        const DB_MAX_WEEKS = 60;
const DB_FIRST_LOW_DECLINE = 0.12;
const DB_SECOND_LOW_UNDERCUT = 0.005;
const DB_SECOND_LOW_MAX_UNDERCUT = 0.05;
const DB_MIDDLE_BOUNCE = 0.08;
const FLAT_MIN_WEEKS = 5;      const FLAT_MAX_WEEKS = 20;
const FLAT_MAX_RANGE = 0.15;
```

### Public API

```typescript
// Main: runs all three detectors, returns highest quality_score match
export function detectChartPattern(dailyRows: OhlcvRow[], volAvg20?: number): PatternResult

// Individual detectors (exported for direct testing)
export function detectFlatBase(weekly: OhlcvRow[]): PatternResult
export function detectCupWithHandle(weekly: OhlcvRow[], volAvg20?: number): PatternResult
export function detectDoubleBottom(weekly: OhlcvRow[], volAvg20?: number): PatternResult
```

### Private helpers

```typescript
function avg(values: number[]): number
function round2(n: number): number
function maxHigh(rows: OhlcvRow[], from: number, to: number): number
function isLocalMin(weekly: OhlcvRow[], idx: number, window: number): boolean
function isLocalMax(weekly: OhlcvRow[], idx: number, window: number): boolean
interface HandleResult { pivotPrice: number; handleEndIdx: number; drift: number; isVolumeContraction: boolean; }
function findHandle(weekly: OhlcvRow[], rimIdx: number, handleStart: number, handleEnd: number, leftHigh: number): HandleResult | null
```

## 4. Schema Changes (src/schema.ts)

### New columns in SQL_CREATE_INDICATORS_DAILY

Add after the `stage INTEGER,` line:

```sql
-- Chart Patterns
base_pattern TEXT,
pivot_price REAL,
buy_range_top REAL,
base_start_date TEXT,
base_length_weeks INTEGER,
base_depth_pct REAL,
base_quality_score INTEGER,
near_pivot INTEGER,
```

### Migration in migrate()

```typescript
addColumnIfNotExists(db, 'indicators_daily', 'base_pattern', 'TEXT');
addColumnIfNotExists(db, 'indicators_daily', 'pivot_price', 'REAL');
addColumnIfNotExists(db, 'indicators_daily', 'buy_range_top', 'REAL');
addColumnIfNotExists(db, 'indicators_daily', 'base_start_date', 'TEXT');
addColumnIfNotExists(db, 'indicators_daily', 'base_length_weeks', 'INTEGER');
addColumnIfNotExists(db, 'indicators_daily', 'base_depth_pct', 'REAL');
addColumnIfNotExists(db, 'indicators_daily', 'base_quality_score', 'INTEGER');
addColumnIfNotExists(db, 'indicators_daily', 'near_pivot', 'INTEGER');
```

## 5. Integration into store.ts

### Import

```typescript
import { detectChartPattern } from './patterns.js';
```

### Call site in computeIndicators()

Pattern detection runs once per symbol on the most recent indicator row only (O(n_symbols),
not O(n_symbols * n_days)).

Inside the per-symbol loop after all indicator rows are computed:

```typescript
const volAvg20 = indicatorRows[indicatorRows.length - 1]?.vol_sma_20 ?? 0;
const patternResult = detectChartPattern(dailyRows, volAvg20);
const latestRow = indicatorRows[indicatorRows.length - 1];

latestRow.base_pattern = patternResult.pattern;
latestRow.pivot_price = patternResult.pivot_price ?? null;
latestRow.buy_range_top = patternResult.buy_range_top ?? null;
latestRow.base_start_date = patternResult.base_start_date ?? null;
latestRow.base_length_weeks = patternResult.base_length_weeks;
latestRow.base_depth_pct = patternResult.depth_pct;
latestRow.base_quality_score = patternResult.quality_score;

if (latestRow.pivot_price && latestRow.close) {
  const dist = (latestRow.pivot_price - latestRow.close) / latestRow.pivot_price;
  latestRow.near_pivot = dist >= 0 && dist <= 0.05 ? 1 : 0;
} else {
  latestRow.near_pivot = 0;
}
```

### IndicatorRow interface additions

```typescript
base_pattern?: string | null;
pivot_price?: number | null;
buy_range_top?: number | null;
base_start_date?: string | null;
base_length_weeks?: number | null;
base_depth_pct?: number | null;
base_quality_score?: number | null;
near_pivot?: number | null;
```

### Volume aggregation check

Verify aggregateToWeekly() sums volume (not averages):

```typescript
// Correct:
volume: weekRows.reduce((sum, r) => sum + r.volume, 0),
```

## 6. New Scans

### scans/breakout/near_pivot.json

```json
{
  "id": "near_pivot",
  "name": "Near Pivot Stocks",
  "description": "Stage 2 stocks within 5% of their chart pattern breakout pivot.",
  "category": "breakout",
  "tags": ["pattern", "pivot", "breakout"],
  "sql": "SELECT symbol, close, pivot_price, buy_range_top, base_pattern, base_length_weeks, base_depth_pct, base_quality_score, stage, sniper_score FROM indicators_daily WHERE date = (SELECT MAX(date) FROM indicators_daily) AND near_pivot = 1 AND stage = 2 AND base_pattern != 'none' ORDER BY base_quality_score DESC"
}
```

### scans/breakout/cup_with_handle.json

```json
{
  "id": "cup_with_handle",
  "name": "Cup with Handle Setups",
  "description": "Stage 2 stocks forming a Cup with Handle. Quality >= 55.",
  "category": "breakout",
  "tags": ["pattern", "cup", "handle"],
  "sql": "SELECT symbol, close, pivot_price, buy_range_top, base_length_weeks, base_depth_pct, base_quality_score, sniper_score, stage FROM indicators_daily WHERE date = (SELECT MAX(date) FROM indicators_daily) AND base_pattern = 'cup_with_handle' AND stage = 2 AND base_quality_score >= 55 ORDER BY base_quality_score DESC LIMIT 30"
}
```

### scans/breakout/flat_base_tight.json

```json
{
  "id": "flat_base_tight",
  "name": "Tight Flat Bases",
  "description": "Stocks in tight flat bases (<=15% range, 5+ weeks). Sorted tightest first.",
  "category": "breakout",
  "tags": ["pattern", "flat", "tight"],
  "sql": "SELECT symbol, close, pivot_price, buy_range_top, base_length_weeks, base_depth_pct, base_quality_score, sniper_score, stage FROM indicators_daily WHERE date = (SELECT MAX(date) FROM indicators_daily) AND base_pattern = 'flat_base' AND stage IN (1, 2) AND base_quality_score >= 50 ORDER BY base_depth_pct ASC, base_quality_score DESC LIMIT 30"
}
```

### scans/breakout/double_bottom_setup.json

```json
{
  "id": "double_bottom_setup",
  "name": "Double Bottom Setups",
  "description": "Stocks forming a Double Bottom (W-pattern). Quality >= 50.",
  "category": "breakout",
  "tags": ["pattern", "double_bottom"],
  "sql": "SELECT symbol, close, pivot_price, buy_range_top, base_length_weeks, base_depth_pct, base_quality_score, sniper_score, stage FROM indicators_daily WHERE date = (SELECT MAX(date) FROM indicators_daily) AND base_pattern = 'double_bottom' AND base_quality_score >= 50 ORDER BY base_quality_score DESC LIMIT 30"
}
```

## 7. New Skill: skills/base_pattern_analysis.md

### Purpose

Analyzes the chart pattern a stock is forming. Use after a stock appears in a pattern
scan. Produces shape narrative, key levels, quality assessment, and actionable trigger.

### Data Context

- {{latest_indicators}} — most recent indicators_daily row (all base_* fields)
- {{symbol_indicators_63d}} — last 63 daily rows (optional, for narrative context)

### Instructions

1. Name the pattern and describe it in plain English (shape, depth, duration, handle status)
2. Report key levels: pivot, buy range (pivot to pivot x 1.05), stop (pivot x 0.92)
3. Assess quality:
   - 80-100: High — institutional accumulation confirmed, act on breakout
   - 60-79: Medium — confirm with volume surge on breakout day
   - 40-59: Low — watch only, need more evidence
   - <40: Avoid
4. State the breakout trigger: close above pivot_price on RVOL >= 1.5
5. Flag risks: depth > 40%, handle > 8 weeks, late-stage base

### Output Schema

```json
{
  "pattern_name": "cup_with_handle|cup_no_handle|double_bottom|flat_base",
  "shape_narrative": "plain English description",
  "pivot_price": 0,
  "buy_range": { "low": 0, "high": 0 },
  "stop_price": 0,
  "base_quality": "High|Medium|Low|Avoid",
  "breakout_trigger": "specific price + volume condition",
  "risk_notes": ["string"]
}
```

## 8. Testing Strategy

### File: src/__tests__/patterns.test.ts

#### Flat base tests

- detects a clean flat base with <10% range (quality_score >= 60)
- rejects range > 15%
- rejects base without prior uptrend (< 20% advance)
- awards volume contraction bonus (+15 when avgBaseVol < priorAvgVol * 0.85)

#### Cup with handle tests

- detects cup with handle, pivot = handle high
- detects cup without handle, pivot = right rim high
- rejects depth < 12%
- rejects depth > 50%
- rejects handle drift > 12% (falls back to cup_no_handle)
- buy_range_top === round2(pivot * 1.05)

#### Double bottom tests

- detects classic double bottom with 2% undercut, pivot = middle peak
- rejects L2 that does not undercut L1
- rejects undercut > 5%
- awards volume bonus when L2 volume < L1 volume * 0.9

#### Integration tests

- returns 'none' for insufficient data (< 35 rows)
- aggregates daily to weekly before detection (70 daily rows forming flat base)
- returns highest quality_score when multiple patterns qualify

### Test data helper

```typescript
function makeWeeklyRows(params: {
  priceSequence: number[];   // weekly close prices
  startDate?: string;
}): OhlcvRow[]
```

### Exit gate

```bash
npm run test -- patterns   # all pattern tests pass
npm run typecheck           # no TypeScript errors
npm run test                # all existing tests still pass
```

## 9. Implementation Phases with Exit Gates

### Phase 1 — Core pattern detection

Files: src/patterns.ts, src/__tests__/patterns.test.ts

Exit gate:
```bash
npm run test -- patterns
```

Defer: schema changes, store.ts integration, scans, skill.

### Phase 2 — Schema and store integration

Files modified: src/schema.ts, src/store.ts

Exit gate:
```bash
export NSE_MARKET_DATA_DB=/tmp/test-patterns.db
node dist/cli.js backfill --symbols RELIANCE.NS
node dist/cli.js compute-indicators

sqlite3 /tmp/test-patterns.db \
  "SELECT symbol, base_pattern, pivot_price, base_quality_score, near_pivot
   FROM indicators_daily
   WHERE symbol = 'RELIANCE.NS'
   ORDER BY date DESC LIMIT 1;"
```

Expected: row returned with base_pattern populated (any value including 'none' is valid).

### Phase 3 — Scans and skill

Files: scans/breakout/near_pivot.json, scans/breakout/cup_with_handle.json,
scans/breakout/flat_base_tight.json, scans/breakout/double_bottom_setup.json,
skills/base_pattern_analysis.md

Exit gate:
```bash
node dist/cli.js scan near_pivot
node dist/cli.js scan cup_with_handle
node dist/cli.js scan flat_base_tight
node dist/cli.js scan double_bottom_setup
```

All commands return output without errors. Agent test:

```
> Run the near_pivot scan and show me the top 5 results
> Invoke the base_pattern_analysis skill for RELIANCE.NS
```

---

## Appendix: Key Gotchas

### Volume must be summed, not averaged, in aggregateToWeekly()

The volume contraction bonuses in all three detectors compare weekly volume to adjacent
periods. If aggregateToWeekly() averages daily volume instead of summing it, the relative
comparison still holds — BUT the absolute values will be wrong if any week has a different
number of trading days (holidays). Sum is always correct.

### Pattern detection is O(n^2) — latest row only

The sliding window search is O(n^2) in weekly bars. For 65 weeks that is ~4,000 iterations
per symbol. Fast per-symbol but do NOT call detectChartPattern() for every historical row.
The rule: call it once per symbol, for the most recent indicator row only.

### Minimum data: 35 daily rows (~7 weeks)

Symbols with fewer than 35 rows return the null pattern. Any symbol with a standard 1-year
backfill has ~252 daily rows, well above the minimum.

### Pattern re-computes naturally on each nse_market_update + compute-indicators run

No special persistence logic needed. As new weekly bars form, a cup may develop a handle,
or a flat base may break its range. The latest run always reflects the current chart state.

### Export from src/index.ts

```typescript
export { detectChartPattern, detectFlatBase, detectCupWithHandle, detectDoubleBottom } from './patterns.js';
export type { PatternResult, BasePattern, NullPattern, PatternName } from './patterns.js';
```
