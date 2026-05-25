# Trend Indicators

Trend indicators define the direction and strength of a stock's price trend across multiple timeframes. Before evaluating momentum, volatility, or setup quality, the trend context established by these indicators tells you whether the overall environment supports a trade.

---

## Exponential Moving Averages

### `ema_20`

20-day EMA. The short-term trend anchor. In a strong uptrend, price consistently bounces off the ema_20 without needing to reach the ema_50 — this is a sign of exceptional momentum. When price dips to the ema_20 and holds with low volume, it is typically the earliest re-entry point in a fast-moving Stage 2 stock.

### `ema_50`

50-day EMA. The intermediate trend line and the most important moving average for swing trading. In a healthy uptrend, pullbacks to ema_50 are primary re-entry points — the stock has cooled enough to offer a reasonable risk/reward without the trend being broken. The ema_50 also acts as a circuit breaker: a close below ema_50 on high volume often signals the end of a swing trade.

### `ema_100`

100-day EMA. Less commonly used but valuable when ema_50 and ema_200 are far apart, as it fills the middle ground and can act as support or resistance during larger corrections. Useful in volatile markets where ema_50 is breached temporarily but ema_100 holds.

### `ema_200`

200-day EMA. The definitive long-term trend divider. Price above ema_200 = bulls in control. Price below ema_200 = bears in control. Widely watched by institutional traders, making it a self-fulfilling level.

A breakout above the ema_200 after an extended period below it often signals a Stage 1-to-Stage 2 transition — the most powerful transition in the market cycle. When the ema_200 itself begins to slope upward, the trend shift is confirmed.

---

## Simple Moving Averages

### `sma_50`

50-day SMA. Widely followed by institutional funds. Many fund managers cite the sma_50 as a discipline line — they reduce exposure when price closes below it. Golden Cross (sma_50 crossing above sma_200) and Death Cross (sma_50 crossing below sma_200) are generated from this pair. While these crossovers are lagging signals, they mark trend changes that attract substantial capital movement.

### `sma_200`

200-day SMA. The classic long-term trend indicator used in Weinstein Stage Analysis. Stage 2 requires price above sma_200 with a positively-sloped sma_200. A rising sma_200 below price is the foundational condition for an institutional-quality uptrend. The `stage` column is partly derived from this.

---

## Composite Metrics

### `ma_stack`

**Type:** INTEGER, range 0–4.

Counts how many of the following trend alignment conditions hold simultaneously:

1. `close > ema_20`
2. `ema_20 > ema_50`
3. `ema_50 > ema_100`
4. `ema_100 > ema_200`

Each condition that holds adds 1 to the score. The result is a single number that encodes the full EMA stack alignment:

| Score | Meaning |
|---|---|
| 4 | Fully aligned bull stack. All EMAs in order. Stage 2 advancing. |
| 3 | Strong uptrend. One level slightly out of alignment — typical in brief pullbacks. |
| 2 | Mixed trend. Sideways, early recovery, or early breakdown. |
| 1 | Weak. Multiple EMA levels inverted. Trend structurally damaged. |
| 0 | Fully inverted. All EMAs out of order. Strong downtrend. |

`ma_stack` is used in:
- `sniper_score` Trend_EMA component (highest single weight at 3.0)
- Setup classification (`base_breakout`, `pullback_to_ema20`, `momentum_continuation` all require `ma_stack >= 3`)
- `stage2_momentum` scan filter
- `tf_alignment_score` daily component

### `ema_50_slope`

Rate of change of the ema_50 over the last 10 trading days:

```
ema_50_slope = (ema_50_today - ema_50_10d_ago) / ema_50_10d_ago
```

A positive and rising ema_50_slope means the intermediate trend is accelerating — the stock is gaining speed, not losing it. When ema_50_slope turns negative, the intermediate trend is losing momentum even if price is still above the ema_50. This is an early warning sign that belongs in Stage 3 analysis.

---

## Using Trend Indicators Together

**For a swing buy entry:**
The ideal condition is `ma_stack = 4`, `ema_50_slope > 0`, and price pulling back to within 2–3% of the ema_20 or ema_50. The EMA stack confirms the trend is intact; the slope confirms the trend is accelerating; the pullback gives you a controlled entry with a defined stop.

**For regime filtering (market-wide):**
Before trading individual stocks, check the NIFTY indicators in `market_state_daily`:
- `nifty_vs_ema50 = 1` — NIFTY is above its 50-day EMA (intermediate bull regime)
- `nifty_vs_ema200 = 1` — NIFTY is above its 200-day EMA (long-term bull regime)

In a bull regime, focus on Stage 2 stocks with `ma_stack >= 3`. In a bear regime (`nifty_vs_ema200 = 0`), reduce position sizes and focus only on the strongest RS leaders.

**For avoiding bad trades:**
Before placing any long, confirm `ma_stack >= 2` at minimum and that `stage` is 1 or 2. A stock with `ma_stack = 0` or `ma_stack = 1` in Stage 4 should be excluded entirely regardless of how cheap it looks on other metrics.
