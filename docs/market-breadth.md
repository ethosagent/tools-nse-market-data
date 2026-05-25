# Market Breadth & Regime Metrics

Market breadth measures how broadly a market move is supported — whether many stocks are participating (healthy) or just a handful (narrowing, dangerous). This tool computes breadth daily across the full NSE universe (~500 stocks) and stores it in `market_state_daily`. Every row is one trading day. 20 days of history is typically enough to identify meaningful breadth trends.

**Why breadth matters:**
A rising NIFTY with deteriorating breadth = distribution. Fewer stocks are carrying the index. This historically precedes corrections. Expanding breadth during a rally = institutional participation = sustainable. The LLM reads breadth sequences — not just today's values — to identify trends, divergences, and inflection points.

---

## NIFTY Reference

| Column | Description |
|---|---|
| `nifty_close` | NIFTY 50 closing price |
| `nifty_vs_ema50` | 1 if NIFTY is above its 50-day EMA, 0 if below |
| `nifty_vs_ema200` | 1 if NIFTY is above its 200-day EMA, 0 if below |
| `nifty_ema50_slope` | Rate of change of NIFTY's EMA50 — positive = rising, negative = falling |
| `nifty_stage` | Weinstein Stage of NIFTY (1–4) |
| `nifty_sniper_score` | Sniper Score for NIFTY itself — single number summarizing regime |

---

## Classic Breadth

| Column | Description |
|---|---|
| `advances` | Number of stocks that closed higher today |
| `declines` | Number that closed lower |
| `unchanged` | Number with no change |
| `ad_ratio` | advances / declines. > 1.5 = broad advance. < 0.67 = broad decline. |
| `pct_above_50ma` | % of universe with close > EMA50. The most watched medium-term breadth indicator. > 60% = healthy bull market. < 40% = weak market. |
| `pct_above_200ma` | % above 200-day MA. Long-term health. Trend from < 40% → > 60% = new bull cycle. |
| `new_highs` | Stocks making 52-week highs today |
| `new_lows` | Stocks making 52-week lows today |
| `up_volume` | Total volume in advancing stocks |
| `down_volume` | Total volume in declining stocks |
| `pct_up_2` | % of stocks up > 2% today — measures broad participation in strong up days |
| `pct_down_2` | % of stocks down > 2% today |

---

## VWAP Breadth

| Column | Description |
|---|---|
| `pct_above_vwap` | % of universe that closed above daily VWAP. > 55% = buyers in control of the session. < 45% = sellers. |

---

## Sniper Intelligence Breadth Metrics

More sophisticated metrics that go beyond simple advance/decline counting:

| Column | Description |
|---|---|
| `ema_stack_bull_pct` | % of stocks with `ma_stack >= 3` (all EMAs bullishly aligned). High = broad bull trend. |
| `ema200_breadth_pct` | % above EMA200. Long-term participation. |
| `ema50_breadth_pct` | % above EMA50. Medium-term participation. |
| `macd_breadth_pct` | % of stocks with positive MACD histogram. Momentum health across the market. |
| `adx_trending_pct` | % with ADX > 25. How many stocks are in active trends (up or down). |
| `avg_rsi` | Average RSI across the entire universe. > 55 = overbought market. < 45 = oversold. 40–55 = neutral. |
| `pct_oversold` | % with RSI < 35. High pct_oversold after a decline = washout = potential bounce. |
| `pct_overbought` | % with RSI > 70. High pct_overbought = market stretched = caution. |

---

## Smart Money Breadth

| Column | Description |
|---|---|
| `smart_money_acc_count` | Stocks with RVOL > 1.5 AND close > open — above-average volume buying days. Count > 200 in a declining market = institutions buying dips. |
| `smart_money_dist_count` | Stocks with RVOL > 1.5 AND close < open — above-average volume selling days. Rising dist_count = distribution in progress. |
| `bull_divergence_count` | Stocks where RSI is making a higher high while price is making a lower high. Bullish divergence — hidden strength. High count at a low = market setting up for reversal. |
| `bear_divergence_count` | Stocks where RSI is making a lower high while price is higher high. Distribution warning. |
| `bb_squeeze_count` | Stocks with BB width at its lowest in 10th percentile — volatility compressed. High count = many setups coiling. A surge in bb_squeeze_count followed by broad breakout = explosive move. |
| `gap_ups_count` | Stocks gapping up at open |
| `gap_downs_count` | Stocks gapping down at open |
| `vol_surges_count` | Stocks with RVOL ≥ 2.0 — extreme volume surges across the market |

---

## Stage Breadth

| Column | Description |
|---|---|
| `stage2_pct` | % of universe in Stage 2 (advancing). The health score for the bull market. > 45% = strong bull. 30–45% = moderate. < 25% = bear market or early recovery. |
| `stage4_pct` | % of universe in Stage 4 (declining). Rising stage4_pct = distribution broadening. > 50% = bear market. |

---

## Mood Score

| Column | Description |
|---|---|
| `mood_score` | INTEGER 0–100. Composite of 10 breadth inputs. The single daily health score for the market. |
| `india_vix` | India VIX closing value. NSE's fear gauge. > 20 = elevated fear, widen stops. > 25 = high fear, reduce position sizes significantly. < 15 = complacency. |

`mood_score` weights:
- ema50_breadth: 20%
- ad_ratio: 15%
- pct_above_vwap: 15%
- macd_breadth: 15%
- ema200_breadth: 10%
- new_highs vs new_lows ratio: 10%
- stage2_pct: 10%
- avg_rsi (normalized): 5%

Remaining 5% from other inputs.

---

## Reading Breadth Sequences

The agent reads 20 days of `market_state_daily` to identify:

**Expanding breadth** — `pct_above_50ma`, `ema_stack_bull_pct`, `stage2_pct` all trending up over 5–10 days while `ad_ratio > 1`. Healthy bull market. Full position sizing appropriate.

**Contracting breadth** — Breadth metrics declining while NIFTY holds flat or rises. Classic distribution. Reduce exposure, tighten stops.

**Breadth washout** — `pct_oversold` spikes above 30%, `new_lows` at multi-month highs, `smart_money_acc_count` rising while price falls. Often marks the end of a correction — institutions buying while retail panics.

**Breadth thrust** — `pct_up_2` > 60% or `ad_ratio` > 3.0 on a big up day. Rare. Historically marks the start of a new bull phase or powerful rally.
