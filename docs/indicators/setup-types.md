# Setup Classifications

Every stock in `indicators_daily` is classified daily into a `setup_type` based on deterministic indicator rules. The setup captures the most actionable technical pattern visible in the data. `NULL` means no recognizable setup applies today.

---

## Columns

### `setup_type`

**Type:** TEXT or NULL. The setup classification. See taxonomy below.

### `setup_quality`

**Type:** INTEGER, range 0–100. How cleanly the conditions for the setup are met. A score of 100 means every condition is satisfied perfectly (e.g., `pct_from_ema20` is exactly −1.0, `rvol` is exactly 0.6, RSI is exactly 52). Lower scores indicate conditions are met but at their edges. High-quality setups are more likely to follow through.

Use `setup_quality` to rank when multiple stocks show the same `setup_type`. A `pullback_to_ema20` with `setup_quality = 85` is cleaner than one with `setup_quality = 55`.

---

## Setup Taxonomy

---

### `base_breakout`

**What it is:** The stock is consolidating near its 52-week high with volatility compressed. The coil is wound. A breakout has not happened yet, but the conditions are aligned for one.

**Conditions:**
- `bb_width` in the bottom 20th percentile of the stock's own 1-year history (volatility compressed)
- This low-volatility state has persisted for at least 10 consecutive trading days
- `dist_52wk_high_pct <= 5` (within 5% of 52-week high)
- `tf_alignment_score >= 2` (at least two timeframes in bullish alignment)
- `stage = 2` (confirmed uptrend — not a stock basing in a downtrend)

**What to do:** Monitor closely. Do not buy before the breakout. Set a conditional buy trigger above the range high (typically `donchian_upper_20` + a small buffer). The entry trigger is a close above the range high with `rvol >= 1.5`. Place the stop below the range low or below `ema_50`, whichever is higher.

**Risk:** A base that fails resolves lower. The lower BB band and the `ema_50` are the natural support levels to watch. If those break on volume, the setup has failed.

**Typical scan filter:** `setup_type = 'base_breakout' AND setup_quality >= 70 AND rs_rank_in_segment >= 65`

---

### `breakout_confirmed`

**What it is:** The breakout happened today. The stock closed at or near a 52-week high with strong volume and held above VWAP — all on the same day.

**Conditions:**
- `dist_52wk_high_pct <= 0.5` (essentially at the 52-week high today)
- `rvol >= 1.5` (elevated volume confirming institutional participation)
- `closed_above_vwap = 1` (buyers controlled the close)
- `stage = 2`

**What to do:**
- Aggressive approach: buy on the breakout day, near the close. Stop below the breakout base.
- Conservative approach: wait for a retest of the breakout level on lower volume. If the stock pulls back to the prior resistance (now support) on low volume and holds, enter there with a tighter stop.

The conservative approach has a lower win rate entry but a better risk/reward on any given trade. The aggressive approach captures the full move on the strongest breakouts that never retest.

---

### `pullback_to_ema20`

**What it is:** A strong, established uptrend stock has pulled back to its 20-day EMA — the earliest and tightest valid re-entry point in a fast-moving trend.

**Conditions:**
- `pct_from_ema20 BETWEEN -3 AND 0` (within 3% below the ema_20)
- `tf_alignment_score >= 2`
- `rsi_14 BETWEEN 45 AND 60` (momentum has cooled off from overbought levels)
- `rvol < 1.0` (pullback is on below-average volume — healthy, not distribution)
- `stage = 2`

**What to do:** Buy near the `ema_20` value. Stop below `ema_50`. Target: prior high or 2× risk distance. The low-volume pullback condition (`rvol < 1.0`) is important — it distinguishes a healthy rest from a high-volume selling episode.

**Risk:** If the stock closes below `ema_50` on the entry day or the next few days, the pullback has become a breakdown. Exit.

---

### `pullback_to_ema50`

**What it is:** A deeper pullback to the intermediate EMA. Stocks in very strong uptrends may only pull back to the `ema_20`, but most Stage 2 stocks will periodically pull back to the `ema_50` — a healthy correction in a bull trend.

**Conditions:**
- `pct_from_ema50 BETWEEN -3 AND 0`
- `close_vs_ema50w = 1` (price is above the weekly 50-period EMA — weekly trend intact)
- `rsi_14 BETWEEN 40 AND 60`
- `stage IN (1, 2)` (Stage 1 stocks approaching ema_50 from below can qualify as potential Stage 1-to-2 entries)

**What to do:** Buy near the `ema_50` value. Stop below `ema_200` or the most recent significant swing low. Target: prior high. The stop below `ema_200` is wide but prevents being shaken out by a final low-volume test of the intermediate level before the next advance.

---

### `ema200_retest`

**What it is:** The stock is testing the 200-day EMA — the major long-term support and trend line. This is a high-stakes test. If the trend is intact, the `ema_200` should hold and provide a springboard. If it fails, the stock transitions to Stage 4.

**Conditions:**
- `pct_from_ema200 BETWEEN -2 AND 2` (within 2% of the ema_200)
- `close_vs_ema20w = 1` (weekly 20-EMA intact — the longer-term trend is still supportive)
- `stage IN (1, 2)` (not a Stage 4 stock bouncing at ema_200 in a downtrend)

**What to do:** This is a high-conviction entry when the weekly trend is intact. Buy near the `ema_200` value. Stop: close below `ema_200` (typically a 2–3% move from entry). Target: prior high. The stop is tight relative to the potential target, which is why this is one of the better-risk/reward setup types.

**Context check:** Always confirm `stage IN (1, 2)` before acting. A Stage 4 stock bouncing at its declining `ema_200` looks similar on a price chart but has very different probabilities. The stage filter is essential.

---

### `momentum_continuation`

**What it is:** An already-strong stock is continuing to advance. This is an add-to-winner setup, not a new initiation from scratch.

**Conditions:**
- `ma_stack = 4` (fully aligned bull stack)
- `rsi_14 BETWEEN 55 AND 75` (strong but not overextended)
- `rvol >= 1.2` (above-average volume — institutional buying continuing)
- `return_1m > 5%` (stock has gained > 5% in the last month — demonstrating active advance)
- `stage = 2`

**What to do:** Add a smaller-than-initial position size (typically 50% of a normal allocation). This is pyramid buying — adding to a winner. Existing holders tighten trailing stops to just below the most recent swing low. The risk/reward is smaller than at the original entry, but the trade is confirmed by realized gains.

**Who this is for:** Traders managing active positions, not those looking for fresh entries. If you are not already in the stock, wait for a pullback setup instead of chasing momentum.

---

### `extended_overdue`

**What it is:** The stock has run far from its mean. New entries here carry poor risk/reward regardless of the trend strength.

**Conditions:**
- `dist_52wk_high_pct <= 2` (near 52-week high)
- `rsi_14 > 75` (significantly overbought)
- `pct_from_ema50 > 10` (>10% above the intermediate mean)
- `stage = 2`

**What to do:** Do not initiate new long positions. This is an informational setup — it tells existing holders to raise stops and consider taking partial profits, and it tells new entrants to wait.

Stocks in this condition often continue higher briefly before a sharp, fast pullback. The pullback then creates either a `pullback_to_ema20` or `pullback_to_ema50` setup — that is when to enter. Chasing `extended_overdue` stocks is one of the most common mistakes in momentum trading.

---

### `oversold_bounce_candidate`

**What it is:** A deeply oversold stock has formed a bullish reversal candle at or near its 52-week low. Speculative setup for a technical bounce.

**Conditions:**
- `rsi_14 < 35` (oversold)
- `dist_52wk_low_pct <= 5` (within 5% of the 52-week low)
- `candle_pattern IN ('hammer', 'bullish_engulf', 'morning_star', 'dragonfly_doji')` (bullish reversal candle)
- `stage IN (1, 2)` (not a Stage 4 stock in freefall)

**What to do:** Speculative bounce trade only. This is a mean-reversion play, not a trend trade. Buy near the close of the reversal candle. Stop below the candle's low — this is a tight, defined risk level. Target: `ema_20` as the first target, `ema_50` as the secondary target.

Do not hold through resistance. This is not a "turn it into a long-term position" setup — it is a tactical bounce. Take gains at targets and move on.

**Critical note on stage:** `stage IN (1, 2)` is required because Stage 4 stocks can be deeply oversold and still decline further. The bounce setup has reasonable odds in a basing (Stage 1) or still-uptrending (Stage 2 that pulled back hard) stock. In a confirmed downtrend (Stage 4), oversold readings are unreliable reversal signals.

---

### `stage1_basing`

**What it is:** The stock is in Stage 1 — the basing phase — but does not meet the specific conditions for any other setup type. A catch-all for Stage 1 stocks worth monitoring.

**What to do:** Add to watchlist. Do not trade yet. The setup transitions to something more actionable when volatility compresses further into `base_breakout`, or when price moves into `ema200_retest` territory, or when the stock shows early RS improvement in `stage1_emerging` scan results.

The value of tagging these is in building a watchlist pipeline. Stocks move from `stage1_basing` to `base_breakout` to `breakout_confirmed`. Tracking them through the pipeline ensures you are positioned before the breakout becomes obvious to everyone.

---

### `recovering_downtrend`

**What it is:** A Stage 3 stock showing early recovery signs. Recent returns are positive despite a broken trend structure.

**Conditions:**
- `ma_stack BETWEEN 1 AND 2`
- `return_1m > 5%`
- `stage = 3`

**What to do:** Watch only. The stock is in the ambiguous zone between Stage 3 (topping/breaking down) and potential Stage 2 recovery. The positive recent return is encouraging but not sufficient. Wait for the stage to transition back to 2 before acting. A `recovering_downtrend` that transitions to Stage 2 with `ma_stack = 4` is a compelling trade — but not before.

---

### `structural_downtrend`

**What it is:** Stage 4. Confirmed downtrend. No actionable bullish setup exists.

**What to do:** Avoid for longs. Full stop. No exceptions based on valuation, dividend yield, or analyst ratings. Stage 4 stocks are in institutional selling mode. Wait for Stage 1 to develop before reconsidering.

---

## Using Setup Types in Practice

**Scan workflow:** Use `setup_type` as the primary filter, then rank by `setup_quality DESC, composite_score DESC`. The top results are the cleanest, highest-conviction setups in the universe on that date.

**Multi-filter example:**
```sql
SELECT symbol, setup_type, setup_quality, composite_score, sniper_score
FROM indicators_daily
WHERE date = '2026-05-25'
  AND setup_type IN ('base_breakout', 'breakout_confirmed', 'pullback_to_ema20')
  AND rs_rank_in_segment >= 65
  AND stage = 2
ORDER BY composite_score DESC
LIMIT 10
```

**Setup quality cutoff:** For `base_breakout` and `pullback_to_ema20`, a quality threshold of 65+ filters out marginal setups and keeps only the clearest conditions. For `breakout_confirmed`, quality is less critical — the breakout is either there (with volume) or it is not.

**Context always wins:** A `base_breakout` on a day when `stage2_pct` in `market_state_daily` is 20% (bear market) is far less actionable than the same setup when `stage2_pct` is 48%. Always check the market context before acting on individual stock setups.
