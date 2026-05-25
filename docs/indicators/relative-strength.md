# Relative Strength

Relative strength measures how a stock performs compared to a benchmark. In any given market environment, some stocks rise more than the index, some match it, and some lag. The consistent leaders — those with persistently high relative strength — are where the biggest returns come from. The consistent laggards destroy capital even in bull markets.

Buying a stock with high RS in a bull regime, at the right entry point, stacks the probabilities in your favor from the start.

---

## Raw Relative Strength

### `rs_vs_segment`

**Type:** REAL. Stock's 3-month return minus its cap-segment benchmark's 3-month return.

```
rs_vs_segment = return_3m - segment_benchmark_return_3m
```

**Benchmark assignments by cap band:**

| Cap Band | Benchmark | Index |
|---|---|---|
| Large Cap | NIFTY 100 | `^CNX100` |
| Mid Cap | NIFTY Midcap 100 | `^NSMIDCP100` |
| Small Cap | NIFTY Smallcap 100 | `^CNXSC` |

A positive `rs_vs_segment` means the stock outperformed its peer group over the last 3 months. A negative value means it underperformed.

**Example:** RELIANCE returned 12% in 3 months. NIFTY 100 returned 8% in the same period. `rs_vs_segment = +4`. RELIANCE is outperforming its large-cap peers.

**Why segment-adjusted matters:** A small-cap stock in a ripping small-cap rally might show `rs_vs_broad = +10` — but if the NIFTY Smallcap index returned 15%, the stock is actually lagging within its own category. `rs_vs_segment` catches this; `rs_vs_broad` does not.

### `rs_vs_broad`

**Type:** REAL. Stock's 3-month return minus NIFTY 500's 3-month return.

```
rs_vs_broad = return_3m - nifty500_return_3m
```

Cross-cap comparison. A mid-cap with `rs_vs_broad = +8` is outperforming the entire market universe by 8%, regardless of what other mid-caps are doing.

`rs_vs_broad` is the most universal RS metric — it answers "is this stock beating the market?" without any category adjustment. Use it when comparing stocks across cap bands or for universe-wide ranking.

---

## RS Rank — Cross-Sectional Percentile

### `rs_rank_in_segment`

**Type:** REAL, range 0–100.

Percentile rank of the stock within its cap band by `rs_vs_segment`. Computed daily across all stocks in the universe.

```
rs_rank_in_segment = percentile_rank(rs_vs_segment) within cap band
```

| Rank | Interpretation |
|---|---|
| ≥ 90 | Top 10% in cap band. Market leader. |
| ≥ 75 | Top 25%. Strong outperformer. |
| 50–75 | Above average. Solid but not a standout. |
| 30–50 | Below average. Lagging peers. |
| < 30 | Bottom third of cap band. Avoid for longs. |

**This is a cross-sectional metric.** It is computed by ranking all 500 stocks simultaneously on a given day, not by looking at a single stock's history. A stock's `rs_rank_in_segment = 80` means 80% of its cap-band peers had lower RS on that date. It does not mean the stock was in the 80th percentile historically.

**Key thresholds:**
- `rs_rank_in_segment >= 80`: The `rs_leaders` scan baseline. These are the stocks institutional funds are overweighting relative to the benchmark.
- `rs_rank_in_segment >= 65`: A practical base filter for any long scan. Removes the bottom half of the universe immediately.
- `rs_rank_in_segment < 40`: Strong negative filter. Unless you are looking for turnaround plays with specific catalysts, avoid these for trend-following.

`rs_rank_in_segment` carries a weight of 1.5 in the `sniper_score` — the second-highest weight among the 7 components. It is one of the strongest discriminators of which stocks to trade.

### `rs_rank_in_sector`

**Type:** REAL, range 0–100.

Percentile rank within the stock's own sector by `rs_vs_broad`.

```
rs_rank_in_sector = percentile_rank(rs_vs_broad) within sector
```

While `rs_rank_in_segment` identifies the best stocks across the full cap band, `rs_rank_in_sector` identifies the best stocks within a sector. These serve different analytical purposes:

- `rs_rank_in_segment` = is this a market leader overall?
- `rs_rank_in_sector` = is this the best stock in its sector?

The combination is powerful: a stock with `rs_rank_in_segment >= 75` AND `rs_rank_in_sector >= 80` is both a market leader AND the best name in its sector. This is the definition of a tier-one candidate.

Sector RS rank is most useful after you have already identified a leading sector (via `sector_state_daily` analysis). Once you know IT sector is outperforming, filter IT stocks by `rs_rank_in_sector >= 70` to find the two or three names driving the sector outperformance.

---

## How to Use RS Effectively

### 1. Sector rotation workflow

The optimal sequence for sector-driven stock selection:

1. Check `sector_state_daily` for sectors with improving `rs_rank_delta_1w` (RS rank gaining week-over-week)
2. Confirm the sector has `stage2_pct` (% of stocks in Stage 2) trending up
3. Filter stocks in that sector by `rs_rank_in_sector >= 70`
4. From that filtered list, apply your preferred setup filter (`base_breakout`, `pullback_to_ema50`, etc.)

This narrows thousands of stocks to a handful of high-conviction candidates in four steps.

### 2. RS as a baseline filter

Before running any bullish scan, add `rs_rank_in_segment >= 65` as a universal pre-filter. This single condition removes roughly half the universe (the underperformers) and keeps the focus on stocks with actual market leadership.

The tradeoff: you will miss some early-stage turnarounds where RS has not yet built up. That is acceptable — turnaround plays require a different, higher-risk framework. For trend-following, stick with the RS filter.

### 3. Setup quality enhancement

Two stocks with identical `setup_type = 'base_breakout'` and similar technical conditions — but one has `rs_rank_in_segment = 85` and the other has `rs_rank_in_segment = 48`. The first is far more actionable. The RS leader has been outperforming before the setup; when it breaks out, it tends to continue outperforming. The RS laggard breaking out often fails to follow through because the underlying relative demand is not there.

### 4. RS divergence — the strongest signal

A stock that maintains or improves its `rs_rank_in_segment` while the broader market is selling off is showing exceptional relative strength. The market is falling but this stock is holding — institutions are not selling it. These names are typically the first to make new highs in the next rally.

Filter for: `rs_rank_in_segment >= 70` during a period when `stage2_pct` in `market_state_daily` is declining. Stocks on this list are the highest-conviction longs for the recovery.

### 5. RS and returns are not the same

`rs_rank_in_segment` can be high even if `return_3m` is negative — as long as the stock fell less than its peers. In a broad correction, a stock that lost 5% while its segment lost 12% would have high RS even though it declined. This is a feature, not a bug: RS leaders in corrections are the first to recover.

When both `rs_rank_in_segment >= 75` AND `return_3m > 0` are true, the stock is both outperforming peers and making absolute gains. This is the ideal combination.
