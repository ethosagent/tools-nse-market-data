# Price Levels & Location

Price location indicators answer WHERE the price is — relative to its mean, relative to its recent range, and relative to key structural levels. Location provides context that pure momentum and trend indicators cannot. The same RSI reading of 65 means something completely different at a 52-week high versus at a 52-week low. These indicators are what resolves that ambiguity.

---

## VWAP — Volume-Weighted Average Price

### `vwap`

**Type:** REAL. Daily VWAP approximation: `(high + low + close) / 3`.

The true intraday VWAP requires tick-level data. This tool stores a daily approximation using the HLC3 midpoint, which represents the average price at which trading likely occurred across the session.

Institutional algorithms — particularly large block desks executing VWAP orders — use VWAP as their execution benchmark. A stock closing above VWAP means that buyers who executed near the VWAP average paid less than the close — they are in profit. A close below VWAP means those buyers are underwater.

For daily analysis, `vwap` is primarily used as a reference for the `closed_above_vwap` flag. Direct comparison of `close vs vwap` is more meaningful than the raw `vwap` number itself.

### `closed_above_vwap`

**Type:** INTEGER: 1 or 0.

Whether the stock's close was above the daily VWAP. `1` = buyers controlled the day and held the gain into the close. `0` = sellers had the upper hand by day's end.

This is a cleaner daily signal than the raw `vwap` value because it collapses the comparison to a binary. It is used in:

- `sniper_score` Volume component: `rvol >= 1.5 AND closed_above_vwap = 1` earns the full +1.0 score
- `breakout_confirmed` setup: requires `closed_above_vwap = 1` to confirm the breakout close is genuine
- `pct_above_vwap` in `market_state_daily` aggregates this across all 500 stocks — a high `pct_above_vwap` reading indicates broad buying pressure that day

---

## 52-Week Range

### `dist_52wk_high_pct`

**Type:** REAL. How far below the 52-week high the current price sits.

```
dist_52wk_high_pct = (high_52w - close) / high_52w × 100
```

A value of 0 means the stock is at its 52-week high today. A value of 20 means it is 20% below its 52-week high.

**Key thresholds:**

| Value | Meaning |
|---|---|
| ≤ 1 | At the 52-week high. Breakout territory. The `breakout_confirmed` scan baseline. |
| ≤ 5 | Near the 52-week high. Stage 2 advancing or `base_breakout` setup region. |
| 5–15 | Moderate distance. Normal pullback range in an uptrend. |
| 15–30 | Significant distance below the high. Likely in correction or Stage 3. |
| > 30 | Deep correction or Stage 4. Avoid for trend-following. |

`dist_52wk_high_pct` is one of the most scan-friendly filters. Requiring it to be ≤ 5% confines the universe to stocks that are near their highs — eliminating Stage 3 and Stage 4 stocks by definition, since those stocks' highs are well above the current price.

### `dist_52wk_low_pct`

**Type:** REAL. How far above the 52-week low the current price sits.

```
dist_52wk_low_pct = (close - low_52w) / low_52w × 100
```

Used in oversold and reversal scans. A stock with `dist_52wk_low_pct <= 5` is within 5% of its 52-week low — deeply depressed. Combined with a bullish reversal candle pattern, this is the setup for the `oversold_bounce_candidate` classification.

### `price_percentile_52w`

**Type:** REAL, range 0–100.

Where the current price sits within the full 52-week range:

```
price_percentile_52w = (close - low_52w) / (high_52w - low_52w) × 100
```

| Value | Meaning |
|---|---|
| 100 | At the 52-week high |
| 70–100 | Upper quartile of the range. Strong positioning. |
| 40–60 | Middle of the range. Neutral. |
| 20–40 | Lower half. Stage 1 basing zone. |
| 0–20 | Near 52-week low. Stage 4 or deep Stage 3. |

Stage analysis uses this heavily:
- Stage 2 stocks typically have `price_percentile_52w > 60` (advancing from the base)
- Stage 1 stocks are in the 20–50 range (basing, not yet advancing)
- Stage 4 stocks are in the 0–30 range (declining)

---

## All-Time High Distance

### `dist_ath_pct`

**Type:** REAL. Distance from the all-time high (ATH).

```
dist_ath_pct = (ath_price - close) / ath_price × 100
```

A value of 0 or negative means the stock is at or above its all-time high. A value of 10 means it is 10% below the ATH.

**Why ATH breakouts are structurally powerful:** When a stock is at its all-time high, there is no overhead supply. Every previous buyer is in profit. There is no one holding the stock "at a loss" who might sell to break even. Price discovery above the ATH happens in a vacuum — the next resistance is psychology and momentum, not prior holders' cost basis.

This is in contrast to a stock recovering from a 40% drawdown to its prior high: millions of shares were bought on the way down, and those holders are watching for a chance to break even and exit. The `ath_breakout` scan (`dist_ath_pct <= 0.5`) finds stocks where this overhead supply condition does not exist.

---

## EMA Distances

### `pct_from_ema20`

**Type:** REAL. Percentage distance of price from the 20-day EMA.

```
pct_from_ema20 = (close - ema_20) / ema_20 × 100
```

Positive = price above ema_20. Negative = price below ema_20.

The `pullback_to_ema20` setup uses `pct_from_ema20 BETWEEN -3 AND 0`. This captures stocks that have pulled back to within 3% of their 20-day EMA — close enough to be a valid re-entry, not so far below that the trend is broken.

A strongly positive `pct_from_ema20` (> +8%) signals the stock is extended above its short-term mean. Not a sell signal, but a poor entry point. Wait for the stock to consolidate and pull back before adding.

### `pct_from_ema50`

**Type:** REAL. Percentage distance from the 50-day EMA.

Same formula applied to `ema_50`. The `pullback_to_ema50` setup requires this between −3 and 0 — stock has pulled back to the intermediate trend line. A deeper pullback (< −5%) raises the question of whether the trend is breaking down rather than pausing.

### `pct_from_ema200`

**Type:** REAL. Percentage distance from the 200-day EMA.

The `ema200_retest` setup looks for `pct_from_ema200 BETWEEN -2 AND 2` — the stock is essentially testing the long-term trend line. This is a high-conviction area: if the trend remains intact and the stock bounces from ema_200, the risk/reward is excellent (stop just below ema_200, target prior highs).

When `pct_from_ema200` is deeply negative (< −15%), the stock is far below its long-term trend line — likely Stage 3 or Stage 4. When it is significantly positive (> +20%), the stock is extended from the long-term mean and would require a substantial correction to retest it.

---

## Using Location Indicators Together

Location indicators are most valuable when they create a coherent picture. A single metric in isolation can mislead; several pointing the same direction create conviction.

**Textbook base breakout setup (location confirmation):**

A stock showing:
- `dist_52wk_high_pct <= 3` (near 52-week high)
- `dist_ath_pct <= 2` (near all-time high, minimal overhead supply)
- `pct_from_ema20 = -1.5` (slight pullback to short-term mean)
- `price_percentile_52w >= 85` (upper range of the year's trading)
- `bb_width` at a multi-month low (volatility compressed)
- `rvol = 0.6` (volume dried up)

Every location metric confirms the same story: the stock is near key highs, pulling back gently, with volume exhausted. This is the coiling setup. The only trigger needed is a volume expansion above the range high.

**Avoiding extended entries:**
- `pct_from_ema50 > 15` combined with `rsi_14 > 75` = the stock is extended. Do not chase. Let it consolidate. The `extended_overdue` setup type flags this condition.

**Finding EMA200 support plays:**
- `pct_from_ema200 BETWEEN -2 AND 1` AND `stage IN (1, 2)` AND `ma_stack >= 2` = stock testing the long-term trend line with the trend still intact. High-quality entry zone if it holds.
