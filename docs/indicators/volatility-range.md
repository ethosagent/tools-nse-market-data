# Volatility & Range Indicators

Volatility indicators measure how much a stock moves, how compressed its recent trading range is, and whether a significant expansion is imminent. They are essential for stop placement, position sizing, and identifying stocks that are coiling for a breakout.

---

## ATR — Average True Range

### `atr_14`

**Type:** REAL. 14-period ATR expressed in price units (rupees).

The Average True Range measures the average daily range of a stock over the last 14 trading days, accounting for overnight gaps. It is the most direct measure of how much a stock actually moves on a given day.

**Stop placement:** The standard use is a 2-ATR stop from entry:

```
stop = entry_price - (atr_14 × 2.0)
```

A 1.5-ATR stop is tighter (more trades stopped out, smaller losses). A 3-ATR stop is wider (fewer false stops, but larger losses when wrong). Adjust the multiplier to your risk tolerance.

**Position sizing:** Given a fixed rupee risk per trade (e.g., ₹5,000), ATR determines how many shares to buy:

```
shares = risk_amount / (atr_14 × atr_multiplier)
```

This normalizes position size across different stocks so you risk the same amount regardless of whether you are buying a ₹500 stock or a ₹5,000 stock.

**Identifying significant moves:** A day's range that exceeds `1.5 × atr_14` is an unusual expansion. On a breakout day, a large range confirms conviction. On a down day, a large range (price opening high, closing low) signals potential distribution or panic selling — meaningful context for the next day's trade decision.

### `adr_pct`

**Type:** REAL. Average Daily Range as a percentage.

```
adr_pct = mean((high - low) / close × 100) over last 14 days
```

Normalizes volatility across stocks trading at different price levels. A stock with `adr_pct = 1.5` moves about 1.5% per day on average. A stock with `adr_pct = 5.0` moves 5% per day.

**Practical use:**
- Filter for volatility comfort: if you want stocks that move enough to offer 1-2% intraday opportunities but not so much that gap risk is unmanageable, filter `adr_pct BETWEEN 1.5 AND 4.0`.
- Position sizing alternative: `adr_pct` is more intuitive than `atr_14` in rupees for comparing across stocks.
- Low-volatility breakouts: `adr_pct` at multi-month lows before a breakout signals a volatility compression setup.

---

## Bollinger Bands

Bollinger Bands are an envelope around price based on statistical deviation from a 20-day mean.

### `bb_upper`

Upper band: `sma_20 + (2 × 20-day standard deviation of close)`

### `bb_lower`

Lower band: `sma_20 - (2 × 20-day standard deviation of close)`

### `bb_middle`

The middle band. This is the 20-day SMA — the same as using SMA20 directly for mean-reversion analysis.

### `bb_width`

**Type:** REAL. The percentage width of the bands relative to the middle band.

```
bb_width = (bb_upper - bb_lower) / bb_middle × 100
```

`bb_width` is the single most important Bollinger Band value for scanning. It measures volatility compression directly:

- High `bb_width` = wide bands = high recent volatility = trending or post-breakout
- Low `bb_width` = narrow bands = volatility compressed = stock coiling, potential big move ahead

**Squeeze identification:** When `bb_width` drops to a multi-month low for a given stock while price is near resistance, the stock is building energy for an expansion. The `base_breakout` setup classification uses `bb_width` in the bottom 20th percentile of the stock's own 1-year history as a required condition.

**Common misconceptions about Bollinger Bands:**
- Price touching the upper band in an uptrend is NOT an overbought sell signal. In a strong Stage 2 advance, price walks up the upper band for weeks — this is a sign of trend strength.
- Price crossing below the lower band is unusual weakness (> 2 standard deviations below the mean), but whether it is a buy or a sell depends entirely on context (stage, trend direction, volume).

**Band squeeze and expansion:**
The classic Bollinger Band trade is the squeeze breakout: `bb_width` contracts to historically low levels (the coil), then expands sharply as price breaks out. The direction of the expansion — above upper band or below lower band — determines whether it is bullish or bearish. `bb_width` alone does not tell you the direction; that requires price action and trend context.

---

## Keltner Channels

Keltner Channels are an EMA-based envelope using ATR as the width measure rather than standard deviation.

### `keltner_upper`

`ema_20 + (2 × atr_14)`

### `keltner_lower`

`ema_20 - (2 × atr_14)`

**Why Keltner matters — the squeeze relationship:** When Bollinger Bands are narrower than Keltner Channels (the BB bands are inside the Keltner envelope), the market is in a squeeze state — volatility is compressed below what the recent ATR would predict. This is a powerful pre-breakout signal.

When the BB bands break outside the Keltner Channels, volatility expansion has begun. The direction the BB breaks out of the Keltner determines trade direction. This relationship is used in the `keltner_breakout` scan.

**Standalone interpretation:** A close above `keltner_upper` means price has moved strongly enough to exceed both the short-term EMA and a multiple of the ATR in a single session. This level of strength is typically associated with institutional buying surges or the initial impulse of a major breakout.

---

## Bollinger vs Keltner: The Squeeze Framework

| Condition | Meaning |
|---|---|
| BB inside Keltner | Squeeze: volatility compressed. Breakout imminent. Watch closely. |
| BB breaks above Keltner upper | Bullish expansion. Breakout direction is up. Go long with the move. |
| BB breaks below Keltner lower | Bearish expansion. Breakdown confirmed. |
| BB wider than Keltner normally | High-volatility trending environment. Normal. |

This framework is the basis of the `keltner_breakout` setup scan.

---

## Donchian Channels

Donchian Channels track the simple highest high and lowest low over a rolling window. They are purely mechanical with no smoothing.

### `donchian_upper_20`

Highest high over the last 20 trading days.

### `donchian_lower_20`

Lowest low over the last 20 trading days.

**Use in scanning:** When `close >= donchian_upper_20`, the stock is at a 20-day high. The `donchian_breakout` scan uses this condition combined with volume confirmation to flag stocks making new 4-week highs.

**Why Donchian for breakouts:** Donchian breakouts are purely price-based and do not require calibration of a standard deviation or an EMA. They are systematic and unambiguous: either the stock is at a new 20-day high or it is not. This makes them ideal for mechanical screening even though they are coarser than Bollinger Band analysis.

**Turtle Trading connection:** Donchian 20-day breakouts are the entry signal from the original Turtle Trading system. The methodology is proven — 20-day highs with volume confirmation have a positive expectancy in trending regimes.

---

## Using Volatility Indicators Together

**Setup timing:** A stock approaching a base breakout with `bb_width` at 1-year lows, BB bands inside Keltner Channels, and `adr_pct` declining (range compressing day by day) — this is the clearest pre-breakout setup the tool can identify. Volume drying up simultaneously (`rvol < 0.7`) confirms the coiling is genuine, not just price drift.

**Stop sizing discipline:** Always anchor your stop to `atr_14`, not to an arbitrary percentage. A 5% stop on a stock with `adr_pct = 4` is only 1.25 ATR — very likely to be hit by normal volatility. A 5% stop on a stock with `adr_pct = 1.5` is 3.3 ATR — excessively wide. ATR-based stops adjust automatically to each stock's actual behavior.

**Post-breakout position management:** After a breakout, `bb_width` expands. Once it stabilizes at a new wider level, the next compression cycle is the next base. Tracking `bb_width` over time on a single stock helps you identify how long its base-building cycles typically last.
