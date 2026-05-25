# Scoring System

The scoring system translates multiple indicator dimensions into a small set of summary numbers. These are used for ranking scan results, filtering the morning brief's `top_setups` list, and quickly assessing conviction level without reading every individual indicator.

---

## Columns

- `sniper_score` — REAL, range approximately −20 to +20
- `sniper_verdict` — TEXT label derived from sniper_score
- `composite_score` — REAL, range 0–100
- `composite_grade` — TEXT: A, B, C, or D
- `tf_alignment_score` — INTEGER: 0–3

---

## Sniper Score

### Range and design

`sniper_score` is a weighted composite of 7 signal components. It measures swing trading readiness on a single number that accounts for trend alignment, MACD momentum, PSAR direction, market cycle stage, relative strength rank, volume conviction, and multi-timeframe alignment.

The score is asymmetric by design: bullish signals can accumulate up to approximately +20, while bearish signals cap around −10. This reflects the asymmetry of long-only swing trading — you need many things to go right before buying, but one or two major bearish signals (Stage 4, inverted EMA stack) are sufficient to disqualify a stock entirely.

### Component breakdown

| Component | Weight | Scoring Rule |
|---|---|---|
| Trend_EMA | 3.0 | +3 if `ma_stack = 4`, +1 if `ma_stack = 3`, −1 if `ma_stack = 2`, −3 if `ma_stack <= 1` |
| MACD | 2.0 | +2 if `macd_hist > 0` and rising (`macd_hist > macd_hist_prev`), +1 if `macd_hist > 0`, −1 if `macd_hist < 0`, −2 if `macd_hist < 0` and falling |
| PSAR | 0.5 | +0.5 if `psar_signal = 1`, −0.5 if `psar_signal = -1` |
| Stage | 0.75 | Raw: +3 if `stage = 2`, +0.75 if `stage = 1`, −0.75 if `stage = 3`, −2.25 if `stage = 4` — then multiplied by the component weight (0.75) |
| RS_Rank | 1.5 | +1.5 if `rs_rank_in_segment >= 75`, +0.75 if `rs_rank_in_segment >= 50`, −0.75 if `rs_rank_in_segment < 30` |
| Volume | 1.0 | +1.0 if `rvol >= 1.5 AND closed_above_vwap = 1`, +0.5 if `rvol >= 1.0`, −0.5 if `rvol < 0.7` |
| TF_Align | 1.0 | +1.0 per aligned timeframe (0 to +3 bonus from `tf_alignment_score`) |

**Trend_EMA carries the highest weight (3.0)** because EMA stack alignment is the most reliable discriminator between tradeable and untradeable market conditions. A stock with `ma_stack = 0` can score high on momentum and volume while still being in a structural downtrend — the Trend_EMA component heavily penalizes this.

**RS_Rank carries the second-highest weight (1.5)** because relative strength is the single best predictor of future outperformance among otherwise-similar technical setups.

### Cross-sectional dependency

`sniper_score` depends on `rs_rank_in_segment`, which requires ranking all stocks simultaneously on the same date. It is computed in Pass 2 of `compute-indicators` — after all per-stock Pass 1 computations are complete — because the cross-sectional percentile cannot be calculated for a single stock in isolation.

This means you cannot compute a theoretically-correct `sniper_score` for a single stock without the full universe's RS data. The stored `sniper_score` values in `indicators_daily` reflect the full cross-sectional ranking as of that date.

### Verdict thresholds

| Score | Verdict |
|---|---|
| ≥ 8 | Strong Buy |
| 4 to 8 | Buy |
| 0 to 4 | Watch |
| −3 to 0 | Avoid |
| < −3 | Sell |

Verdict labels are stored in `sniper_verdict`. They are coarse categories — use the raw `sniper_score` for ranking, not the verdict label. A stock with `sniper_score = 7.9` (verdict: Buy) is nearly identical to one with `sniper_score = 8.1` (verdict: Strong Buy).

### Reading a sniper_score

A `sniper_score` of +12 means the stock is scoring well across most or all components. Decomposing it: `ma_stack = 4` (+9 from Trend_EMA after weight), `macd_hist > 0` and rising (+4 from MACD after weight), `stage = 2` (+2.25 from Stage), `rs_rank_in_segment >= 75` (+2.25 from RS_Rank), `tf_alignment_score = 3` (+3 from TF_Align), `rvol >= 1.5 AND closed_above_vwap = 1` (+1 from Volume), `psar_signal = 1` (+0.5 from PSAR) = approximately +22 before asymmetric capping.

A `sniper_score` of −5 is a disqualified stock: likely `ma_stack <= 1` (−9 from Trend_EMA), `stage = 4` (−1.69 from Stage after weight), `macd_hist` falling and negative (−4 from MACD), `rs_rank_in_segment < 30` (−1.125 from RS_Rank).

---

## Composite Score

### Range and design

`composite_score` is a 0–100 normalized version of `sniper_score`, adjusted slightly by `rs_rank_in_segment`. It maps the raw sniper scale to a more intuitive 100-point range and penalizes stocks with strong technical signals but poor relative strength.

### Grade thresholds

| Range | Grade | Interpretation |
|---|---|---|
| 80–100 | A | Top-tier setup. High conviction. Prioritize these. |
| 65–79 | B | Strong candidate. Worth active monitoring. |
| 50–64 | C | Average. Low priority unless in a leading sector or with a specific catalyst. |
| 0–49 | D | Below average. Avoid unless seeking contrarian plays with a specific thesis. |

### Primary use

`composite_score` is the default sort key for scan results. When 20 stocks match a scan condition, sorting by `composite_score DESC` puts the highest-conviction setups at the top.

It is also the ranking input for the `top_setups` list in the `nse_market_brief` — the daily morning brief presents the 5–10 highest `composite_score` setups across all scan types as its primary actionable list.

**Composite vs sniper:** Use `composite_score` for ranking and filtering. Use `sniper_score` when you want to understand the level of conviction and decompose which components are contributing. They point in the same direction — high `composite_score` always corresponds to high `sniper_score` — but `composite_score` is easier to reason about in a 0–100 context.

---

## TF Alignment Score

### Range and design

`tf_alignment_score` counts how many timeframes — daily, weekly, and monthly — are in bullish alignment. It ranges from 0 to 3.

### Scoring rules

**Daily alignment (1 point):**
`ma_stack >= 3 AND rsi_14 > 50 AND macd_hist > 0`

The daily timeframe is bullish if the EMA stack is mostly aligned, momentum is above the midpoint, and MACD is positive.

**Weekly alignment (1 point):**
Close above the 20-week EMA AND close above the 50-week EMA AND weekly RSI > 50 (computed from daily data aggregated to weekly bars).

The weekly timeframe confirms the intermediate trend. A stock can have a great daily setup but be in a weekly downtrend — this captures that mismatch.

**Monthly alignment (1 point):**
Close above the 10-month EMA AND `return_3m > 0` (the most recent quarter was positive — monthly trend intact).

The monthly timeframe is the big picture. A stock above its 10-month EMA with positive 3-month returns is in a durable uptrend at the macro level.

### Interpretation

| Score | Meaning |
|---|---|
| 3 | All timeframes aligned bullish. Strongest possible trend context. Only go long. |
| 2 | Two timeframes aligned. Good. One level has a counter-trend wobble but the bigger picture supports the trade. |
| 1 | One timeframe bullish. Mixed signals across the trend hierarchy. Be selective and use tighter stops. |
| 0 | No timeframes aligned. Avoid long positions entirely. |

### Where it matters

`tf_alignment_score` is a required condition in several setup classifications:
- `base_breakout`: requires `tf_alignment_score >= 2`. A base breakout setup is only valid when at least two timeframes confirm the trend — daily-only setups in weekly or monthly downtrends have poor follow-through.
- `stage2_momentum` scan: requires `tf_alignment_score >= 2`. Ensures the momentum candidates are aligned across multiple timeframes.

It is also a component in `sniper_score` (TF_Align weight = 1.0, contributes 0–3 points).

---

## How the Scores Work Together

The three scores form a hierarchy:
- `tf_alignment_score` sets the multi-timeframe context (0–3)
- `sniper_score` provides the conviction level across all 7 dimensions (≈−20 to +20)
- `composite_score` normalizes everything to a ranking-friendly 0–100

**Example — high conviction:**
`composite_score = 84`, `sniper_score = 10.5`, `tf_alignment_score = 3`, `sniper_verdict = 'Strong Buy'`

This stock is firing on all cylinders. Daily, weekly, and monthly trends are all bullish. The EMA stack is perfectly aligned. MACD is rising. RS rank is in the top quartile. Volume is above average and closing strong. This is a top-priority setup.

**Example — good setup, weak multi-timeframe context:**
`composite_score = 72`, `sniper_score = 6.8`, `tf_alignment_score = 1`, `sniper_verdict = 'Buy'`

A good daily setup, but only one timeframe is aligned. The weekly or monthly trend is not supportive. This is a lower-conviction trade. If taken, use a tighter stop and a smaller position size than normal. It is a valid trade but not a high-conviction one.

**Example — avoid:**
`composite_score = 32`, `sniper_score = -4.2`, `tf_alignment_score = 0`, `sniper_verdict = 'Sell'`

All timeframes misaligned, negative sniper score, below-median composite. This stock should not appear in any long scan output. If it does (due to a non-score filter), skip it.

---

## Practical Usage Patterns

**Morning brief filter:** The `nse_market_brief` uses `composite_score >= 70 AND setup_type IS NOT NULL AND stage = 2` as the baseline for its top_setups list. Stocks below 70 composite rarely appear in the brief.

**Scan ranking:** Always `ORDER BY composite_score DESC` when presenting scan results. Within the same setup type, higher composite score = cleaner setup + better RS + more aligned trend.

**Score floor:** For any actionable long, consider a minimum of `composite_score >= 60` (grade C or better) as a soft floor. Below 60, the technical case is too mixed to justify a trade unless there is a specific non-technical catalyst.
