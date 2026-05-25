# Momentum Indicators

Momentum indicators measure the speed and force behind price movement. They answer: is the current trend strengthening or weakening? Is the stock overbought, oversold, or in the momentum sweet spot? Used alongside trend and volume indicators, momentum indicators sharpen entry and exit timing.

---

## RSI — Relative Strength Index

### `rsi_14`

**Type:** REAL, range 0–100. Wilder's 14-period RSI.

Measures the ratio of average gains to average losses over the last 14 trading days. Stored as a 0–100 number.

**Interpretation zones:**

| Range | Meaning |
|---|---|
| 70–100 | Overbought. Extended above the mean. Higher risk for new entries. |
| 50–70 | Bullish momentum zone. Ideal range for swing longs. |
| 40–50 | Neutral. Trend losing steam or in early pullback. |
| 30–40 | Weakening. Trend at risk or in correction. |
| 0–30 | Oversold. Potential reversal zone. |

**Critical nuance — RSI in strong uptrends:** In a Stage 2 stock with `ma_stack = 4`, RSI can stay between 50 and 80 for months without reaching 30. Waiting for RSI to drop to 30 before buying a strong uptrend means never buying it. RSI above 50 with a rising EMA stack is participation, not a warning. The oversold interpretation applies primarily to ranging or declining stocks.

**Divergence signals:** These are the highest-value RSI readings, but they require manual analysis:
- Bearish divergence: price making a higher high while RSI makes a lower high. Hidden distribution — sellers are getting stronger even as price advances. Often precedes Stage 2-to-3 transitions.
- Bullish divergence: price making a lower low while RSI makes a higher low. Hidden accumulation — buyers are absorbing selling pressure. Often precedes Stage 1-to-2 transitions.

---

## MACD — Moving Average Convergence Divergence

### `macd`

The MACD line: `12-day EMA minus 26-day EMA`. Positive MACD = short-term EMA above long-term EMA = upward momentum. Negative = downward momentum.

### `macd_signal`

The signal line: 9-day EMA of the MACD line. Acts as a trigger. When the MACD crosses above the signal line, momentum is turning bullish.

### `macd_hist`

**Type:** REAL.

`macd minus macd_signal`. The histogram. The most actionable MACD value stored:
- Positive and growing: bullish momentum increasing
- Positive but shrinking: momentum slowing, still bullish
- Crossing zero from below: fresh bullish cross
- Negative and shrinking: bearish momentum increasing
- Crossing zero from above: fresh bearish cross

### `macd_hist_prev`

Previous day's histogram value. Enables two critical detections without needing to query the prior row:

**Crossover detection:** `macd_hist > 0 AND macd_hist_prev <= 0` = MACD histogram just crossed zero from below. Bullish cross fired today. This is the entry signal for the `macd_cross` scan.

**Acceleration detection:** `macd_hist > macd_hist_prev AND macd_hist > 0` = histogram expanding. Momentum building, not fading.

**Deceleration warning:** `macd_hist < macd_hist_prev AND macd_hist > 0` = histogram shrinking while still positive. The rally is losing force. Not a sell signal by itself, but worth watching.

---

## ADX — Average Directional Index

### `adx`

**Type:** REAL, range 0–100. 14-period ADX.

Measures trend strength regardless of direction. A stock with `adx = 35` is in a strong trend — but whether it is up or down requires the DI lines.

| ADX Value | Trend Strength |
|---|---|
| < 20 | No trend. Price is choppy or ranging. Avoid trend-following strategies. |
| 20–25 | Weak trend developing. Watch closely. |
| 25–40 | Confirmed trend. Trend-following strategies are valid. |
| > 40 | Strong trend. Momentum strategies have an edge. |
| > 60 | Extreme trend. Rare. Often followed by reversal. |

### `adx_di_plus`

+DI (Plus Directional Indicator). Measures upward pressure. When +DI > −DI, buyers are stronger than sellers.

### `adx_di_minus`

−DI (Minus Directional Indicator). Measures downward pressure. When −DI > +DI, sellers are stronger.

**Combined use:** `adx > 25 AND adx_di_plus > adx_di_minus` = confirmed uptrend with meaningful strength. Use ADX as a filter before entering trend-following trades — a stock with `adx < 20` is likely to chop and stop you out even if the direction call is correct.

---

## Stochastic Oscillator

### `stoch_k`

%K(14,3). The fast stochastic line. Measures where the current close sits within the 14-day high-low range, smoothed over 3 periods.

### `stoch_d`

%D. 3-period SMA of %K. The signal line.

**Interpretation:**
- < 20 = oversold zone
- > 80 = overbought zone

**Primary signal:** %K crossing above %D while both are below 20 = oversold reversal. %K crossing below %D while both are above 80 = overbought reversal.

**Context matters:** In strong uptrends, stochastic can stay above 80 for extended periods — this is a sign of momentum, not a sell trigger. Stochastic is most useful in ranging markets where overbought and oversold readings have predictive value. In trending markets, use it to identify pullback exhaustion (stochastic dipping to 20–30 and turning back up within an uptrend) rather than waiting for > 80 to sell.

---

## CCI — Commodity Channel Index

### `cci_20`

**Type:** REAL. CCI(20).

Measures how far the current typical price `(high + low + close) / 3` deviates from its 20-day mean, normalized by average deviation.

| CCI Range | Interpretation |
|---|---|
| > +200 | Strongly overbought. Extended move. |
| +100 to +200 | Bullish momentum. Price well above mean. |
| −100 to +100 | Neutral. Normal trading range. |
| −100 to −200 | Bearish momentum. Price well below mean. |
| < −200 | Strongly oversold. |

**Crossover signals:** CCI crossing +100 from below = potential breakout beginning. CCI crossing −100 from above = potential breakdown beginning. These are cleaner signals than the absolute value readings.

---

## Williams %R

### `williams_r`

**Type:** REAL, range −100 to 0.

Williams %R(14). Like RSI but inverted and normalized differently. Measures where the current close sits within the 14-day range from the perspective of the high:

```
%R = (14d_high - close) / (14d_high - 14d_low) × -100
```

| %R Range | Interpretation |
|---|---|
| −20 to 0 | Overbought. Price near 14-day high. |
| −80 to −100 | Oversold. Price near 14-day low. |

**Reversal timing:** Williams %R responds faster to price changes than RSI because it uses the highest high (not an average), making it more sensitive to recent extremes. When %R crosses above −80 from below (becomes less negative), it signals oversold exhaustion. Williams %R is most useful for short-term pullback entry timing within an established uptrend — wait for %R to reach −70 to −80 range and then turn upward before entering.

---

## Parabolic SAR

### `psar`

**Type:** REAL. The Parabolic SAR price level.

A trailing stop-and-reverse indicator that accelerates as the trend continues. The PSAR dot moves closer to price as the trend extends, eventually being hit and reversing when momentum fades.

### `psar_signal`

**Type:** INTEGER: 1 or −1.

- `1` = price is above the PSAR dot = bullish trend
- `−1` = price is below the PSAR dot = bearish trend

### `psar_signal_prev`

Previous day's PSAR signal. Enables flip detection without a subquery:

**Bullish flip:** `psar_signal = 1 AND psar_signal_prev = -1` = PSAR just turned bullish today. The trend has reversed from bearish to bullish according to PSAR — a high-conviction entry signal when combined with `ma_stack >= 3`.

**Bearish flip:** `psar_signal = -1 AND psar_signal_prev = 1` = PSAR just turned bearish. Consider reducing long exposure.

**As a trailing stop:** When `psar_signal = 1` in a Stage 2 stock, the `psar` price value is a live trailing stop level. If price closes below the PSAR value, the system will flip to −1 the next day — active traders can use this as a mechanical exit discipline.

---

## Rate of Change

### `roc_5`

**Type:** REAL. 5-day rate of change expressed as a percentage.

```
roc_5 = (close - close_5d_ago) / close_5d_ago × 100
```

Measures short-term price momentum over the past week of trading. A high `roc_5` on a breakout day (e.g., +8% in 5 days) confirms the move is impulsive rather than drifting. Stocks in the top quartile of `roc_5` are showing near-term leadership.

**Caution:** Very high `roc_5` (> 15%) can indicate overextension. Pair with `pct_from_ema50` to check whether the stock is getting too far from its mean.

---

## Return Columns

These are price returns over fixed lookback windows, stored for scan efficiency and RS calculation.

| Column | Lookback | Primary Use |
|---|---|---|
| `return_1d` | 1 day | Today's change. Daily price action. |
| `return_1w` | 5 days | Short-term momentum. |
| `return_1m` | 21 days | Monthly momentum. Used in `momentum_continuation` setup. |
| `return_3m` | 63 days | **Primary RS input.** 3-month return drives `rs_vs_segment` and `rs_vs_broad`. |
| `return_6m` | 126 days | Intermediate-term strength. |
| `return_1y` | 252 days | Full-year performance. |
| `return_ytd` | Since Jan 1 | Year-to-date. Used in annual rankings and sector comparison. |

**Why `return_3m` is the most important:** The 3-month window balances recency with statistical reliability. It is long enough to filter out noise but short enough to reflect current leadership. IBD-style relative strength rankings, the `rs_vs_segment` and `rs_vs_broad` columns, and the cross-sectional `rs_rank_in_segment` percentile all use `return_3m` as their primary input. When a stock's `return_3m` is in the top decile of its peer group, it is a market leader by definition.

---

## Using Momentum Indicators Together

**Setup confirmation:** Before entering a `pullback_to_ema50` setup, confirm `rsi_14` is between 40–60 (cooled off), `macd_hist > 0` (still in positive territory), and `adx > 20` (a trend exists worth fading back into). Three green lights = higher conviction.

**Avoiding false breakouts:** A price breakout with `rsi_14 < 55` and `macd_hist <= 0` lacks momentum confirmation. Wait for these to align before acting on a price-only signal.

**Reading PSAR + RSI together:** A PSAR bullish flip (`psar_signal_prev = -1, psar_signal = 1`) while RSI is crossing back above 50 = dual confirmation that the short-term trend has reversed to bullish. This combination is more reliable than either signal alone.
