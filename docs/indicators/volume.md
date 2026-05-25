# Volume & Flow Indicators

Volume tells you whether price moves have conviction. Price without volume is noise. A breakout on low volume is a potential trap. A breakout on high volume is institutional commitment. A pullback on low volume is healthy. A pullback on high volume is potential distribution. Volume indicators stored in this tool include both standard technical metrics and NSE-specific delivery data not available in most retail screeners.

---

## Relative Volume

### `rvol`

**Type:** REAL. Today's volume divided by the 20-day average volume.

```
rvol = volume_today / vol_sma_20
```

`rvol = 1.0` is exactly average. Everything is relative to this baseline:

| RVOL Value | Interpretation |
|---|---|
| ≥ 2.0 | Twice normal volume. Strong institutional participation. High-conviction move. |
| 1.5–2.0 | Elevated volume. Good confirmation of breakouts or reversals. |
| 1.0–1.5 | Slightly above average. Normal trending environment. |
| 0.7–1.0 | Below average. Reduced interest. Normal for pullbacks in uptrends. |
| < 0.7 | Low volume. Drift, disinterest, or coiling. |
| < 0.5 | Volume dried up. Stock is resting. Classic pre-breakout quiet period. |

**On breakout days:** Want `rvol >= 1.5` as a minimum for confirmation. `rvol >= 2.0` on a 52-week high breakout is strong evidence of institutional buying. A breakout day with `rvol < 1.0` is suspicious — the move may fail.

**On pullback days:** Want `rvol < 0.8` for a healthy pullback within an uptrend. High-volume pullbacks (`rvol > 1.2` on a down day) signal potential distribution — institutions selling while the stock is still near highs.

**On base/consolidation days:** `rvol < 0.6` for multiple consecutive days = volume drying up = coiling. This is the quiet period that precedes major breakouts. The `base_breakout` setup benefits from seeing low `rvol` over the consolidation period.

### `vol_sma_20`

**Type:** INTEGER. 20-day simple moving average of volume.

The baseline denominator for `rvol`. Also used directly to filter for minimum liquidity: require `vol_sma_20 >= 50000` (50,000 shares/day) to exclude illiquid micro-caps that look good on charts but have poor fill quality.

### `avg_dollar_volume_20`

**Type:** REAL. Rupee-denominated average daily liquidity.

```
avg_dollar_volume_20 = vol_sma_20 × avg_close_20d
```

The most practical liquidity filter. A stock with `avg_dollar_volume_20 = 5,000,000` (₹50 lakh/day) is tradeable for most retail and semi-institutional sizes. A stock with `avg_dollar_volume_20 = 500,000` (₹5 lakh/day) will have wide spreads and impact cost that eats into any edge.

Typical filters by account size:
- Small accounts (< ₹5 lakh): `avg_dollar_volume_20 >= 5000000` (₹50 lakh/day minimum)
- Mid accounts (₹5–50 lakh): `avg_dollar_volume_20 >= 25000000` (₹2.5 crore/day minimum)
- Larger accounts: `avg_dollar_volume_20 >= 100000000` (₹10 crore/day minimum)

---

## NSE Delivery Data

These columns are derived from NSE's official bhavcopy data. They represent a significant edge over Yahoo Finance-only data — delivery percentage is one of the clearest institutional footprint signals available in public data.

### `delivery_pct`

**Type:** REAL. Percentage of traded volume resulting in actual share delivery.

NSE reports both total traded quantity and delivery quantity for every equity each day. The delivery percentage is:

```
delivery_pct = (DELIV_QTY / TTL_TRD_QNTY) × 100
```

Retail intraday traders square off their positions before market close — their volume appears in traded quantity but not in delivery quantity. Institutional investors buying for portfolios take delivery of shares. This makes `delivery_pct` one of the most direct proxies for institutional accumulation or distribution available in daily data.

**Interpretation by direction:**

| Day Type | delivery_pct | Interpretation |
|---|---|---|
| Up day | > delivery_ma_20 × 1.5 | Institutions increasing holdings. Strong accumulation signal. |
| Up day | Near delivery_ma_20 | Normal buying. No special interpretation. |
| Down day | > delivery_ma_20 × 1.5 | Institutions selling into weakness. Distribution signal. |
| Down day | < delivery_ma_20 × 0.7 | Retail selling. Institutions not participating in the sell-off. Potentially healthy. |

Typical delivery percentages vary by stock type. F&O-heavy stocks (heavily traded derivatives) tend to have lower delivery percentages (20–35%) because speculative trading is high. Less liquid stocks or fundamentally-driven names can have delivery percentages of 60–80% on institutional buying days.

### `delivery_ma_20`

**Type:** REAL. 20-day average delivery percentage for this stock.

The baseline for relative delivery comparison. A delivery_pct of 45% means nothing without knowing whether the stock's normal delivery is 25% or 60%. `delivery_pct / delivery_ma_20` is the relative delivery ratio — the same concept as `rvol` applied to delivery.

The `delivery_surge` scan uses `delivery_pct > delivery_ma_20 × 1.5 AND return_1d > 0` to find stocks where unusually high delivery coincided with an up day — the clearest accumulation signal in the tool.

---

## On-Balance Volume

### `obv`

**Type:** REAL. Cumulative On-Balance Volume.

OBV accumulates volume in the direction of price movement:

```
if close > prev_close: obv += volume
if close < prev_close: obv -= volume
if close == prev_close: obv unchanged
```

The absolute value of OBV is meaningless — it depends on when the calculation began. What matters is the direction and trend of OBV relative to price:

**OBV rising ahead of price:** Smart money (institutions) are accumulating before the breakout becomes visible to everyone. This is the classic OBV leading signal — OBV making new highs while price is still in a base.

**OBV confirming price:** OBV rising with price = healthy uptrend. Volume is behind the move.

**OBV diverging from price (bearish):** Price making new highs but OBV is flat or declining = distribution. Sellers are absorbing buying pressure at higher prices. This is a Stage 2-to-3 warning.

**OBV diverging from price (bullish):** Price making new lows but OBV is flat or rising = accumulation at lows. Buyers are absorbing selling pressure.

### `obv_slope_5d`

**Type:** REAL. 5-day directional proxy for OBV.

```
obv_slope_5d = (obv_today - obv_5d_ago) / abs(obv_5d_ago)
```

Positive = volume has been net-positive over the past week. Negative = volume has been net-negative. This is one of the four smart money proxy inputs used in accumulation/distribution classification.

---

## Close Position Ratio

### `close_position_ratio`

**Type:** REAL, range 0–100.

Where the price closed within the day's range:

```
close_position_ratio = (close - low) / (high - low) × 100
```

| Value | Meaning |
|---|---|
| 100 | Closed at the high of the day. Maximum buying pressure. |
| 75–100 | Strong close. Buyers controlled the session. |
| 40–60 | Neutral. Balanced session. |
| 0–25 | Weak close. Sellers controlled the session. |
| 0 | Closed at the low. Maximum selling pressure. |

A high `close_position_ratio` (> 75) on a high-volume day means buyers not only drove volume but held their gains through the close — no profit-taking or reversal. This combination is the clearest single-day accumulation signal.

A low `close_position_ratio` (< 25) on high volume means sellers dominated: the day opened or ran up, then sold off to close near the low. This is textbook distribution regardless of whether the close was up or down from the open.

---

## Smart Money Classification

The four volume-flow inputs — `delivery_pct vs delivery_ma_20`, `rvol`, `close_position_ratio`, and `obv_slope_5d` — are designed to be read together for smart money analysis. No single signal is reliable in isolation; the combination is.

**Accumulation pattern:**
- `delivery_pct > delivery_ma_20 × 1.3` (elevated delivery)
- `rvol >= 1.2` (above-average volume)
- `close_position_ratio > 70` (strong close in upper range)
- `obv_slope_5d > 0` (OBV trending up over the week)
- `return_1d > 0` (up day)

**Distribution pattern:**
- `delivery_pct > delivery_ma_20 × 1.3` (elevated delivery — institutions participating)
- `rvol >= 1.2` (above-average volume)
- `close_position_ratio < 30` (price closed near the low — selling dominated)
- `obv_slope_5d < 0` (OBV declining over the week)

**Neutral / inconclusive:**
- Mixed signals across the four inputs
- Low `rvol` across the board (not enough participation to classify)

Use the `smart_money_candidates` scan to pre-filter stocks showing potential accumulation or distribution, then ask for a deeper analysis of the individual stock's volume profile. The agent can assess the pattern across multiple days, not just the most recent row.
