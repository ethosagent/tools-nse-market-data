# base_pattern_analysis

## Purpose

Analyzes the chart pattern a stock is forming. Use after a stock appears in a pattern scan. Produces shape narrative, key levels, quality assessment, and actionable trigger.

## Data Context

- {{latest_indicators}} — most recent indicators_daily row (all base_* fields)
- {{symbol_indicators_63d}} — last 63 daily rows (optional, for narrative context)

## Instructions

1. Name the pattern and describe it in plain English (shape, depth, duration, handle status)
2. Report key levels: pivot, buy range (pivot to pivot × 1.05), stop (pivot × 0.92)
3. Assess quality:
   - 80–100: High — institutional accumulation confirmed, act on breakout
   - 60–79: Medium — confirm with volume surge on breakout day
   - 40–59: Low — watch only, need more evidence
   - <40: Avoid
4. State the breakout trigger: close above pivot_price on RVOL >= 1.5
5. Flag risks: depth > 40%, handle > 8 weeks, late-stage base

## Output Schema

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
