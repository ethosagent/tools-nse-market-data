# Candle Patterns

Candlestick patterns are timing signals. They do not tell you whether a stock is worth owning — trend, stage, RS, and volume do that. What they tell you is whether the most recent session showed exhaustion, reversal, or continuation. A hammer at EMA50 support with declining volume and RSI cooling to 50 is a high-conviction entry. The same hammer in the middle of a choppy Stage 1 range is noise.

Use candle patterns to confirm setups that already score well on other dimensions. Never use them as standalone trade triggers.

---

## Column

### `candle_pattern`

**Type:** TEXT or NULL.

The detected pattern for the most recent daily bar. NULL means no recognized pattern was detected. When multiple patterns qualify simultaneously, 2–3 bar patterns take priority over single-bar patterns, and higher-conviction patterns take priority over lower-conviction ones.

---

## Bullish Single-Bar Patterns

### `hammer`

**What it looks like:** Small real body at the top of the day's range. Long lower wick of at least twice the body length. Little or no upper wick.

**What it means:** During the session, sellers pushed price significantly lower. But buyers absorbed all that selling and drove price back up to close near the open — rejecting the lower prices. The long lower wick is evidence of buying conviction.

**When it matters:** At the bottom of a decline, near support levels (ema_50, ema_200, 52-week low). The hammer is weak in isolation and strong at confluence. A hammer forming exactly at the ema_50 with below-average volume (the selloff exhausted itself) is a high-quality entry signal.

**Volume confirmation:** The hammer's signal is stronger when the session volume is below average (sellers ran out of supply before they could drive price lower) or above average (large buyers stepped in forcefully). The pattern works in both scenarios but means different things.

### `inverted_hammer`

**What it looks like:** Small real body at the bottom of the range, long upper wick (at least twice the body), little or no lower wick.

**What it means:** Buyers tried to push price significantly higher during the session but failed — the close was back near the open. The attempt, however, is itself meaningful: demand exists at these prices. Sellers who watch for failed rallies should note that buyers were willing to push aggressively, even if they could not hold the gains.

**When it matters:** At the bottom of a decline. Slightly less reliable than a hammer as a reversal signal because the close was weak (near the low), but it is still a valid watch signal for the next session.

### `dragonfly_doji`

**What it looks like:** Open, close, and high are all at (or very near) the same level, with a long lower wick.

**What it means:** The session opened, sold off sharply, and recovered entirely to close at the high. Maximum buying conviction — sellers tried twice and failed completely. One of the purest bullish reversal signals at support.

**When it matters:** At well-defined support (ema_50, ema_200, prior lows). The `oversold_bounce_candidate` setup accepts dragonfly_doji as a qualifying reversal candle alongside hammer and bullish_engulf.

### `marubozu_bull`

**What it looks like:** Large body spanning almost the entire day's range. Open equals (or is very close to) the low. Close equals (or is very close to) the high. No meaningful wicks.

**What it means:** Buyers were in complete control from open to close. Not a single meaningful reversal occurred intraday. This is the continuation candle — it appears in the middle of strong uptrends and on the first day of powerful breakouts.

**When it matters:** On breakout days (`rvol >= 2.0`, `dist_52wk_high_pct <= 1`), a marubozu_bull confirms the breakout is impulsive. On continuation days in established Stage 2 stocks, it signals the trend is accelerating.

---

## Bearish Single-Bar Patterns

### `shooting_star`

**What it looks like:** Small real body at the bottom of the range, long upper wick (at least twice the body), little or no lower wick. The mirror image of a hammer.

**What it means:** Buyers drove price significantly higher during the session, but sellers took over and pushed the close back near the open. The long upper wick shows supply at higher prices.

**When it matters:** At the top of an advance, near resistance levels. A shooting_star at a prior high or after a strong run-up in a Stage 2-3 transition is a warning. Combine with declining `rvol` on the day and `rsi_14 > 70` for higher conviction.

### `gravestone_doji`

**What it looks like:** Open, close, and low are at (or very near) the same level, with a long upper wick.

**What it means:** The most bearish doji. Price opened, rallied sharply, then gave back everything to close at the low. Sellers rejected higher prices completely.

**When it matters:** At resistance, after a sustained advance. More decisive than a shooting_star because the close is literally at the open — no ambiguity about who controlled the session.

### `marubozu_bear`

**What it looks like:** Large body, open near the high, close near the low. Sellers in complete control from open to close.

**When it matters:** On breakdown days or in the early stages of Stage 4. Confirms sellers are committed — not just profit-taking but active selling pressure from open to close.

---

## Neutral / Indecision Patterns

### `doji`

**What it looks like:** Open and close are at (or very near) the same level, with wicks on both sides. A cross shape.

**What it means:** Complete indecision. Buyers and sellers fought to a draw. The session's outcome depends entirely on context:

- At the top of an uptrend after multiple advancing candles: distribution warning. The advance is running out of buyers.
- At the bottom of a decline: accumulation possibility. Sellers are running out of supply.
- In the middle of a range: noise. No actionable signal.

### `long_legged_doji`

A doji with very long wicks on both sides. Open and close nearly equal, but extreme intraday movement. Signals heightened indecision and is often a precursor to a significant directional move. The direction is not determined by the doji itself but by the next session's price action.

### `spinning_top`

Small real body (larger than a doji) with wicks on both sides. Less extreme than a doji. Indecision, but the session had more directional movement during the day. Same contextual interpretation as a doji — more important at extremes (tops and bottoms) than in ranging environments.

---

## Multi-Bar Reversal Patterns

### `bullish_engulf`

**What it looks like:** A 2-bar pattern. Day 1 is a bearish (red) candle. Day 2 is a bullish (green) candle whose body completely engulfs Day 1's body — opens below Day 1's close and closes above Day 1's open.

**What it means:** Sellers controlled Day 1. Buyers completely overran the sellers on Day 2. The shift in control is decisive — not just a small bounce but a complete reversal of the prior session's range.

**When it matters:** At support levels after a pullback. `bullish_engulf` is one of the highest-reliability single-entry signals in the tool. The `oversold_bounce_candidate` setup and `candle_reversal_bull` scan both accept this pattern. Volume confirmation (Day 2 volume > Day 1 volume) strengthens the signal significantly.

### `bearish_engulf`

The mirror: Day 1 bullish, Day 2 bearish and completely engulfs Day 1's body. Sellers took over convincingly. At resistance, after an advance, this is a distribution warning.

### `morning_star`

**What it looks like:** A 3-bar pattern. Day 1 is a large bearish candle. Day 2 is a small body (doji or spinning top) that gaps down from Day 1 — indecision at the lows. Day 3 is a large bullish candle that closes well into Day 1's body (at least 50% back).

**What it means:** Day 1 shows sellers in control. Day 2 shows the selling exhausted (small body = neither side dominant). Day 3 shows buyers returning in force. This sequence — breakdown, indecision, strong recovery — is the textbook bottom reversal pattern.

**When it matters:** At support, after a decline. The morning_star requires three consecutive sessions to form, making it a less common but more reliable signal than single-bar patterns. One of the strongest bullish reversal patterns in the tool.

### `evening_star`

The mirror of morning_star: 3-bar top reversal. Day 1 large bullish, Day 2 small body (indecision at the highs), Day 3 large bearish close well into Day 1's body. Classic distribution pattern at the top of an advance.

### `piercing_line`

A 2-bar bullish reversal. Day 1 is a large bearish candle. Day 2 opens below Day 1's low (gap down) but closes above the midpoint of Day 1's body. Strong buying on Day 2 that absorbed the gap-down weakness and reached back into Day 1's range. Less decisive than bullish_engulf (does not fully engulf) but still a meaningful reversal signal, particularly at support with volume.

### `dark_cloud_cover`

A 2-bar bearish reversal. Day 1 is a large bullish candle. Day 2 opens above Day 1's high (gap up) but closes below the midpoint of Day 1's body. Strong selling that absorbed the gap-up enthusiasm and pushed back into Day 1's range. The mirror of piercing_line — a warning at resistance, especially if `rvol` is elevated on Day 2.

---

## How Candle Patterns Integrate with Setups

**`oversold_bounce_candidate` setup:** Requires one of `hammer`, `bullish_engulf`, `morning_star`, or `dragonfly_doji` in addition to `rsi_14 < 35` and proximity to the 52-week low. The candle pattern is the timing trigger — without it, the stock is simply oversold (and can stay oversold for weeks). With it, there is evidence that the selling pressure exhausted itself on the pattern day.

**`candle_reversal_bull` scan:** Filters for bullish reversal patterns (hammer, bullish_engulf, morning_star, dragonfly_doji) combined with RSI context and stage conditions. Pre-filters to stocks where the reversal pattern is meaningful, not noise.

**`stock_deep_analysis`:** When the agent analyzes a stock, the most recent `candle_pattern` is interpreted in the full context: the stage, price level relative to EMAs, volume profile, and RSI. A hammer in isolation is a footnote. A hammer at ema_50, after a 3-day low-volume pullback, with RSI cooling to 52 from 68, with `ma_stack = 4` — that is a trade.

**Priority rule for candle interpretation:** Always ask "where is this candle forming?" before acting. A bearish engulf at a 52-week high after a 40% run-up is a serious warning. A bearish engulf at the ema_20 during a healthy pullback in a Stage 2 stock is likely noise — just the normal volatility of a rising trend.
