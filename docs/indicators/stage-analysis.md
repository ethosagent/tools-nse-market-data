# Stage Analysis (Weinstein Method)

Stage Analysis classifies every stock into one of four market cycle stages. Developed by Stan Weinstein, the framework divides a stock's life cycle into four distinct phases: basing, advancing, topping, and declining. Each stage has clear characteristics, specific indicator footprints, and — critically — a defined action rule.

The stage is the single most powerful trade filter in the tool. Before evaluating any other indicator, know the stage. Stage 4 stocks destroy capital regardless of how cheap they look on other metrics. Stage 2 stocks build it.

---

## Column

### `stage`

**Type:** INTEGER: 1, 2, 3, or 4.

---

## Stage 1 — Basing

### What is happening

The stock has stopped falling and is moving sideways. It is digesting the prior decline. Sellers who drove the stock down have exhausted their supply. Buyers are cautiously testing the waters but have not committed enough to drive the stock higher. The result is a flat, range-bound price action.

### Indicator footprint

- Price is near the sma_200 (within approximately 5%), not trending strongly above or below it
- sma_200 is flattening out after a downtrend — the slope is approaching zero
- `ma_stack` is typically 1–2 (some EMAs are in order, others are not)
- `price_percentile_52w` is between 20–50 (stock is in the middle-to-lower part of its annual range)
- `bb_width` declining or at multi-month lows (volatility compressing)
- Volume declining overall — the selling pressure is drying up
- `obv` flat or gently rising while price is flat — possible early smart money accumulation
- `rsi_14` oscillating around 40–55, not making sustained moves above 60

### What to do

Watch. Do not buy yet. A Stage 1 base can last anywhere from a few weeks to over a year. Entering too early means sitting in dead money while capital could be deployed in Stage 2 stocks.

Set a watchlist alert for when `dist_52wk_high_pct` narrows below 5% and `rvol` begins to pick up above 1.0. These are the early signals of a Stage 1-to-2 transition. The `stage1_emerging` scan identifies Stage 1 stocks that are beginning to show improving relative strength — the earliest birds.

### What it looks like on a chart

Flat or gently oscillating price action. Bollinger Bands squeezing tighter over time. Volume declining week by week. The stock is coiling. The EMA20 and EMA50 are both flat and overlapping. The SMA200 is curling from down to flat.

---

## Stage 2 — Advancing

### What is happening

The stock has broken out of its base and is in a confirmed uptrend. Institutional buyers have committed. Earnings or fundamentals may have improved, but even without a catalyst, the supply/demand balance has shifted decisively toward buyers. Price is making higher highs and higher lows. Each pullback is bought.

This is the only stage where buying aggressively is appropriate.

### Indicator footprint

- `price > sma_200` — price is above the long-term trend line
- `sma_200` slope is positive — the long-term trend line itself is rising
- `ma_stack >= 3` — EMA stack is aligned bullish
- `price_percentile_52w > 50` — stock is in the upper half of its annual range, advancing
- `rsi_14` typically between 50–75, not spending extended time below 50
- `ema_50_slope > 0` — intermediate trend is rising
- `rs_rank_in_segment >= 50` — outperforming at least half of its peers

### Stage 2 sub-phases

**Early Stage 2:** `stage = 2`, `dist_52wk_high_pct > 15`. The stock has broken out of Stage 1 but is still well below the prior 52-week high (which may be from a prior cycle). `price_percentile_52w` around 50–65. The advance has begun but has not yet reached full momentum.

**Mid Stage 2:** The stock is making new 52-week highs. `dist_52wk_high_pct <= 10`. `rs_rank_in_segment >= 60`. The EMA stack is perfectly aligned (`ma_stack = 4`). This is the bulk of the advance — where the majority of returns are captured.

**Late Stage 2:** `dist_52wk_high_pct <= 5`, `pct_from_ema50 > 15`, `rsi_14 > 70`. The stock is extended from its mean. The advance is mature. Stop tightening is appropriate — trailing stops below ema_20 rather than ema_50.

### What to do

Buy on pullbacks to ema_20 (fast market) or ema_50 (normal market). The `pullback_to_ema20` and `pullback_to_ema50` setup types capture these entries. Add to winners on `momentum_continuation` signals. Hold as long as the EMA stack remains intact (ma_stack >= 3) and price holds above ema_50 on closing basis.

Exit signals during Stage 2: price closes below ema_50 on above-average volume, or `ma_stack` drops to 2 or below and does not recover within a few days.

### What it looks like on a chart

Staircase pattern of higher highs and higher lows. Price consistently bouncing off the ema_20 or ema_50. SMA200 sloping upward beneath the price. Breakouts to new highs on high volume, pullbacks on low volume.

---

## Stage 3 — Topping

### What is happening

The uptrend is faltering. The stock is still above the SMA200 (technically a bull market stock), but the trend structure is weakening. Distribution is occurring — institutions that bought in Stage 1 and early Stage 2 are selling to late retail buyers. Price action becomes erratic, with sharp moves in both directions and no clear directional progress.

### Indicator footprint

- `price > sma_200` (still technically above long-term trend)
- BUT `ma_stack <= 2` — EMA stack breaking down
- `rsi_14 < 60` even during bounces — momentum is weakening
- `ema_50_slope` turning negative or flat
- `return_1m < 0` — recent price action is negative
- Volume spikes on down days (distribution) versus lower volume on up days
- `bb_width` may have contracted (post-advance volatility squeeze) or be expanding erratically
- `obv` diverging from price — OBV flat or declining while price is still near highs

### What to do

Reduce or exit long positions. Do not add. The risk/reward of holding a Stage 3 stock is poor. The stock may resolve back into Stage 2 (a healthy reset), but it may continue into Stage 4. The tool cannot predict which outcome — what it can tell you is that the probability of a profitable continuation has dropped significantly.

Stage 3 is the ambiguous stage. Some stocks spend weeks here before recovering. Others fall straight into Stage 4. The discipline is to reduce exposure when the stage shifts from 2 to 3, then re-enter only when the stock proves it has transitioned back to Stage 2 (not before).

### What it looks like on a chart

Volatile, choppy price action above the SMA200. Multiple failed attempts to make new highs. Price chopping between support and resistance with no net progress. EMAs beginning to converge and flatten. Institutional distribution disguised as normal volatility.

---

## Stage 4 — Declining

### What is happening

The stock is in a confirmed downtrend. All trend indicators are inverted. Sellers are in control across all timeframes. There is no ambiguity about the direction.

### Indicator footprint

- `price < sma_200` — below the long-term trend line
- `sma_200` slope is negative — the long-term trend line itself is declining
- `ma_stack <= 1` — EMA stack fully inverted
- `price_percentile_52w < 30` — in the lower portion of the annual range
- `rsi_14 < 45` persistently
- `rs_rank_in_segment < 25` — underperforming most peers

### What to do

Avoid completely for longs. Full stop. A Stage 4 stock that looks "cheap" is a value trap — it was expensive at 100, expensive at 80, and it is not cheap at 60. The decline may continue to 40, 30, or less. Cheap is not a reason to buy. Stage is.

Wait for Stage 4 to transition to Stage 1 (basing). The transition shows up as SMA200 flattening, price stabilizing in a range, and volume drying up. Only then does the stock enter the consideration zone — and even then, not for buying yet. Stage 1 leads to Stage 2 which leads to the buy.

The `structural_downtrend` setup type maps directly to Stage 4 stocks. These are explicitly excluded from all bullish scan results.

---

## Stage Distribution in `market_state_daily`

These are market-wide breadth readings that contextualize the individual stock stage:

### `stage2_pct`

The percentage of the 500-stock universe currently in Stage 2. This is the bull market health gauge.

| Value | Market Condition |
|---|---|
| > 50% | Strong bull market. Most stocks are advancing. Aggressive long bias appropriate. |
| 35–50% | Healthy bull market. Broad participation. |
| 25–35% | Mixed. Sector rotation or early correction. Be selective. |
| < 25% | Bear market or deep correction. Reduce exposure significantly. |

### `stage4_pct`

The percentage of the universe in Stage 4.

| Value | Market Condition |
|---|---|
| > 50% | Confirmed bear market. Majority of stocks in downtrend. |
| 30–50% | Significant distribution. High caution warranted. |
| 15–30% | Normal. Some stocks always declining even in bull markets. |
| < 15% | Very healthy bull market. Broad participation. |

**Regime rule:** When `stage4_pct > stage2_pct`, the bear market regime is active — more stocks are declining than advancing. In this environment, reduce long exposure, increase cash, and focus only on the top 10–15% by RS rank.

---

## Stage Analysis and Other Indicators

Stage is upstream of everything else. Before looking at RSI, MACD, or candle patterns, know the stage. Then use the other indicators to time entries within Stage 2 or exits during Stage 3.

A Stage 2 stock with RSI of 70 is not overbought — it is strong. A Stage 4 stock with RSI of 28 is not oversold — it is declining and may continue lower. The same RSI value has opposite implications depending on stage.

The `setup_type` classifications are stage-aware by design. No bullish setup (`base_breakout`, `pullback_to_ema20`, `momentum_continuation`) is assigned to a Stage 4 stock. No `structural_downtrend` setup is assigned to a Stage 2 stock. Stage gates the entire classification system.
