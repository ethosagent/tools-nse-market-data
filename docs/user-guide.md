# User Guide

This guide walks through the full analysis workflow — from checking whether the market environment is favorable all the way to placing a specific trade. Each step maps to one stage of the analysis funnel. Read it end-to-end once, then use the example prompts as a starting point for your sessions.

---

## Step 1 — Market Regime Check

**Question: Is the market environment favorable for swing trading?**

Start here every session, before looking at any individual stock. The regime tells you how aggressive to be with position sizing and how selective to be about which setups to act on.

Call `nse_market_brief`. The `regime` section returns:

- `nifty_close`, `vs_ema50`, `vs_ema200` — is NIFTY above or below its key moving averages?
- `ema50_slope` — is the 50-day EMA rising or falling? A rising EMA50 means the medium-term trend is intact.
- `stage` (1–4) — Weinstein stage for NIFTY itself. Stage 2 = advancing bull market. Stage 4 = declining.
- `sniper_score_nifty` — NIFTY's composite score using the same formula applied to individual stocks.

The `breadth` section tells you what the full universe of 500 stocks is doing:

- `mood_score` (0–100) — composite of 10 breadth inputs. Above 60 = bullish environment. Below 40 = caution.
- `pct_above_50ma`, `pct_above_200ma` — participation. In a healthy bull, 60%+ of stocks are above their 50-day MA.
- `stage2_pct`, `stage4_pct` — how many stocks are in the advancing phase vs declining phase.
- `ad_ratio` — advance/decline ratio. Sustained A/D above 1.0 confirms healthy breadth.
- `india_vix` — fear gauge. VIX above 20 = elevated volatility, reduce position size. Above 25 = wait.

**What the agent does with it:** classifies the regime (Strong Bull / Moderate Bull / Neutral / Moderate Bear / Strong Bear) and recommends a position size adjustment (100% / 75% / 50% / 25% / 0% of normal). It also flags divergences — price rising while breadth contracts is a distribution warning worth noting even in a bull phase.

**Why sequences matter more than snapshots:** `nse_market_brief` returns today's numbers, but the agent's value is in comparing them to 5 and 20 days ago using `market_state_daily` history. "Breadth has been contracting for 8 consecutive days during a NIFTY rally" is a pattern a rule-based screener cannot detect.

Example prompt:
> "Check the market regime and tell me how aggressive I should be right now."

---

## Step 2 — Sector Rotation

**Question: Where is money flowing into?**

Even in a strong bull market, not all sectors move at the same time. Institutional money rotates — when it flows into a sector, the best stocks in that sector tend to outperform. Your job is to identify which sectors are receiving that flow and concentrate your stock picks there.

`nse_market_brief` returns `top_sectors` sorted by RS rank. Each sector entry includes:

- `return_1w`, `return_1m` — recent performance relative to the market.
- `rs_rank` (0–100) — where this sector ranks among all 17 sectors by relative strength. 80+ means top-tier momentum.
- `rs_rank_delta_1w` — how the RS rank changed in the past week. A sector jumping from 50 to 72 in one week is rotating in. A sector dropping from 65 to 40 is rotating out.
- `pct_members_uptrend` — what % of stocks in this sector are above their EMA50. High numbers mean the move is broad, not driven by one or two large caps.
- `pct_members_stage2` — what % of sector members are in the advancing phase.
- `rotation_signal` — `improving` (rs_rank_delta_1w > 5), `deteriorating` (< -5), or `stable`.

The `sector_state_daily` table stores 4+ weeks of history. Ask the agent to analyze the trajectory, not just today's snapshot.

**What the agent does with it:** identifies sectors where `rotation_signal = 'improving'` AND `rs_rank_delta_1w` is large AND member breadth is expanding. Recommends 1–2 leading sectors to focus stock picks within. Calls out sectors to avoid where RS rank is falling and member breadth is contracting.

Example prompt:
> "Which sectors are rotating into favor this week? Where should I focus my stock picks?"

---

## Step 3 — Stock Scanning

**Question: Which stocks are setting up right now?**

With the regime classified and the leading sectors identified, run scans to find the specific stocks that are setting up.

`nse_run_scan` runs any of 35+ pre-built scans against the full Nifty 500 universe, a cap segment, or your watchlist. Scans are organized into six categories:

**In a bull regime — leading sectors only:**
- `base_breakout` — stock consolidating near its 52W high, volatility compressed, tension building.
- `breakout_confirmed` — already broke out today with volume confirmation. Higher risk/reward for aggressive entries.
- `pullback_to_ema50` — strong uptrend pulling back to the 50-day EMA. Classic re-entry after a healthy correction.
- `momentum_surge` — strong trend accelerating. Adding to existing positions rather than initiating.
- `stage2_entry` — stock just entered Stage 2 advancing phase. Early stage, highest reward.

**In a neutral or early recovery regime:**
- `stage1_emerging` — stocks basing near SMA200, volume drying up. Watching, not buying yet.
- `rs_leaders` — stocks outperforming their segment regardless of market direction. Defensive and opportunistic.
- `pullback_to_ema` — broad pullback scan when conditions aren't ideal for breakout buying.

**For smart money detection:**
- `smart_money_candidates` — volume surge + high delivery % + close in upper half of day's range + rising OBV. Pre-filters to ~50–100 stocks before asking the agent to classify each as accumulation, distribution, or neutral.

`nse_market_brief` also returns `scan_density` — how many stocks in the universe match each major scan today. High `pullback_to_ema50` density in a bull regime means the market is offering buying opportunities across the board. Low density means setups are scarce and selectivity should increase.

**Setup types the scan system classifies:**

| Setup Type | What it means |
|---|---|
| `base_breakout` | Consolidating near 52W high, Bollinger Band width compressed, Stage 2 — ready to break |
| `breakout_confirmed` | Broke out today with rvol ≥ 1.5 and close above VWAP — confirmation in |
| `pullback_to_ema20` | In strong uptrend, pulled back to EMA20 with low volume — ideal re-entry |
| `pullback_to_ema50` | Deeper pullback to EMA50, still Stage 2 or Stage 1 with weekly support |
| `ema200_retest` | Testing the 200-day MA as support, weekly trend intact |
| `momentum_continuation` | MA stack 4, RSI 55–75, volume confirmation — trend extending |
| `extended_overdue` | Near 52W high, RSI > 75, overextended — use for exits, not entries |
| `oversold_bounce_candidate` | RSI < 35, near 52W low, reversal candle forming — countertrend opportunity |
| `stage1_basing` | Consolidating below SMA200, watching for Stage 2 transition |
| `recovering_downtrend` | In Stage 3, recovering — too early to buy, monitor |
| `structural_downtrend` | Stage 4 — avoid |

Example prompts:
> "Run the base_breakout scan across Nifty 500. Filter to stocks in IT and Capital Goods sectors."
>
> "What's the scan density today? Is the market giving us enough setups to be active?"

---

## Step 4 — Individual Stock Analysis

**Question: Is this specific stock worth acting on?**

Once a scan surfaces a candidate, use `nse_market_indicators` to pull 63 days of indicator history for the symbol and do a full read.

Work through these layers in order:

**Stage first.** Is the stock in Stage 2 (advancing)? Stage 1 stocks are worth watching but not buying. Stage 3 and 4 — skip entirely. `stage` in `indicators_daily` is deterministic: price > SMA200, SMA200 slope positive, `ma_stack` ≥ 3, `price_percentile_52w` > 50 = Stage 2.

**Trend alignment.** `ma_stack` of 3–4 means price is above EMA20, which is above EMA50, which is above EMA200. Perfect stacking. `tf_alignment_score` 2–3 means the daily, weekly, and monthly timeframes all agree the stock is in an uptrend. A tf_alignment_score of 1 means timeframes are mixed — the trade needs more confirmation before entry.

**Relative strength.** `rs_rank_in_segment` ≥ 65 means this stock is outperforming at least 65% of its peers in its cap band. Buy the leaders, not the laggards. Below 40 = something is wrong with this stock relative to its peers.

**Volume confirmation.** `rvol` ≥ 1.5 on a breakout day means volume is 50% above the 20-day average — institutions are participating. `delivery_pct` above `delivery_ma_20` means the volume is delivery-based (investors taking positions and holding overnight), not intraday speculation. This is the NSE-specific institutional signal.

**Momentum zone.** `rsi_14` between 50–70 is the bullish zone for swing entries — not oversold, not overbought. `macd_hist` > 0 and rising means momentum is building. If RSI has been above 50 for 6 weeks and is now at 55 after a pullback, that's healthy consolidation. If RSI dropped from 72 to 45 on heavy volume, that's a trend break.

**Setup quality.** `setup_quality` (0–100) and `sniper_score` give you the overall read. `sniper_score` above 8 = Strong Buy, 4–8 = Buy, 0–4 = Watch.

**OBV trend.** `obv_slope_5d` positive = volume has been flowing in over the past week. This is a clean confirmation that buyers have been more aggressive than sellers on a multi-day basis.

**Candle pattern.** `candle_pattern` today — a hammer or bullish engulfing candle at a key support level (EMA20, EMA50, 52W high breakout point) is the final confirming signal.

The 63-day history window lets the agent reason about trajectory, not just today's reading. "RSI has held above 50 for 6 consecutive weeks, now pulling back to 55 on low volume — healthy consolidation" is a different read from "RSI was at 70, crossed below 50 two weeks ago — trend is breaking."

Example prompt:
> "Deep analysis on LTIM.NS — is it a buy right now or should I wait for a better entry?"

---

## Step 5 — Watchlist Management

**Question: Which stocks do I want to track closely?**

The watchlist is your working set of high-quality candidates — stocks you've already vetted through the analysis funnel and want to monitor daily.

Use `nse_watchlist_add` to add a stock with optional notes explaining the setup thesis. Use `nse_market_screen` to filter your watchlist by any indicator condition. Use `nse_watchlist_show` for a quick status view with latest prices.

`nse_market_brief` includes a `watchlist_alerts` section — watchlist stocks that triggered notable conditions today: new 52W high, volume surge above 1.5x, setup_type change (e.g. moved from `stage1_basing` to `breakout_confirmed`). This means you don't need to check every watchlist stock individually — the alert system surfaces the ones that matter.

**Watchlist curation principles:**

Keep 15–25 stocks maximum. More than that and you lose focus — everything looks like a candidate on some scan or another. Diversify across 3–4 leading sectors (not 10 sectors — follow the rotation). Include a mix of active setups (ready to trade this week) and early-stage setups (Stage 1 basing stocks to buy when Stage 2 begins). Cull stocks that drop to Stage 3 or 4, or whose RS rank falls below 40.

The quality bar for watchlist inclusion: Stage 2 (or Stage 1 with a clear Stage 2 catalyst), `composite_score` ≥ 65, `rs_rank_in_segment` ≥ 60, sector in the top half of rotation.

Example prompts:
> "Screen my watchlist for stocks in Stage 2 with setup_type set and rvol above 1.2 today."
>
> "Which watchlist stocks are within 3% of a 52-week high?"
>
> "Remove stocks from my watchlist that have dropped to Stage 3 or Stage 4."

---

## Step 6 — Trade Setup and Planning

**Question: What exactly is my entry, stop, and target?**

When a watchlist stock reaches its trigger, use `nse_invoke_skill` with `skill_id = 'trade_setup'` to generate a full Sniper Intelligence trade plan. The skill reads `indicators_daily` for the stock and produces:

**Entry zone:** depends on setup type. For `pullback_to_ema20`, the entry is around `ema_20` ± `atr_14 × 0.3`. For `base_breakout`, the entry is above the consolidation high (the 52W high level).

**Stop loss:** placed below the last meaningful support level minus an ATR buffer. Default: key support − `atr_14 × 2.0`. For a `pullback_to_ema50` setup, the stop goes below the EMA50. ATR-based stops adapt to each stock's actual volatility — a low-volatility large cap gets a tighter stop than a high-beta mid cap.

**Targets:** calculated at 1:2 and 1:3 R:R from the entry zone. The agent calculates exact R:R from your specified entry.

**Position size:** based on the 1% risk rule — risk 1% of your portfolio on any single trade.

```
shares = (portfolio × 0.01) / (entry - stop)
capital_required = shares × entry
```

The agent also applies the regime adjustment. If the regime is Neutral, it reduces position size to 50% of normal even if the individual stock looks great. Strong Bull = full size. Bear = stay out.

**R:R filter:** minimum acceptable is 1.5:1. If the math doesn't work at 1.5, the trade is skipped or the entry is adjusted to a better price. 2.0+ is preferred.

Example prompt:
> "Plan a trade for LTIM.NS. Portfolio is ₹10 lakh, risk 1% per trade. Current setup type is pullback_to_ema50."

---

## Step 7 — Daily Morning Routine

**Question: What should I focus on today?**

One prompt to start the day:

> "Give me today's morning brief. What's the regime, which sector is leading, and which of my watchlist stocks should I focus on?"

The agent assembles this in one call using `nse_market_brief` + `nse_invoke_skill('morning_brief')`:

1. **Regime status** — is the regime the same as yesterday, or has it shifted? A shift from Moderate Bull to Neutral is relevant even if NIFTY is flat.
2. **Top rotating sector** — which sector has the strongest improving RS rank delta this week, and why (member breadth expanding, top stock leading).
3. **Watchlist setups today** — watchlist stocks with an active `setup_type` sorted by `composite_score`. These are the ones to focus on.
4. **Smart money signals** — any unusual delivery/volume activity in watchlist stocks today. A stock with 2x average volume and 80% delivery is receiving institutional interest.
5. **Risk posture for the day** — e.g. "Neutral regime + VIX at 18 = 50% normal size, A+ setups only." This is the position sizing guidance for any trade you consider today.
6. **One key level to watch** — the specific price on NIFTY or a watchlist stock that, if crossed, changes the outlook.

---

## Additional Capabilities

### Smart Money Detection

Run the `smart_money_candidates` scan first — it pre-filters to stocks with above-average volume, high delivery %, close in the upper portion of the day's range, and rising OBV. Then invoke `nse_invoke_skill('smart_money_scan')` to have the agent classify each stock as ACCUMULATION, DISTRIBUTION, or NEUTRAL.

The four raw inputs the agent reasons from:

- `delivery_pct` vs `delivery_ma_20` — institutional delivery above the 20-day average means professional money is taking positions and holding overnight.
- `rvol` — the volume surge magnitude. 2x+ average is unusual enough to signal intent.
- `close_position_ratio` — (close − low) / (high − low) × 100. A reading near 100 means the stock closed at the top of its range — buyers were in control all day.
- `obv_slope_5d` — OBV trend over 5 days. Steadily rising OBV into a quiet price consolidation is the classic accumulation pattern.

This is a useful filter before acting on a breakout. A `base_breakout` setup with institutional accumulation signals is higher conviction than one with flat delivery and neutral OBV.

Example prompt:
> "Run the smart_money_candidates scan and classify the results — which stocks look like accumulation?"

### Breadth Trend Analysis

Ask the agent to analyze how market breadth has evolved over the past 20 trading days using `market_state_daily` history. The patterns worth detecting:

- **Breadth contracting while price holds up** — distribution. Institutions are selling into retail buying. This typically precedes a correction by 1–3 weeks.
- **Breadth expanding from an oversold low** — early bull signal. When `mood_score` crosses from below 40 to above 50 while `pct_above_50ma` is rising, it's a regime improvement signal.
- **`smart_money_acc_count` rising while price is flat or slightly down** — institutions accumulating on quiet days. Precedes the next leg up.

Example prompt:
> "Analyze market breadth over the past 20 trading days. Has breadth been expanding or contracting? Any divergences from NIFTY price?"

### Sector Deep Dive

Ask the agent to analyze a specific sector in full: which stocks are in Stage 2, which have the highest `composite_score`, which the smart money appears to be accumulating, and what the sector's RS rank trajectory looks like over 4 weeks. The output tells you whether the sector rotation is early (just starting to improve), mid-cycle (RS rank high and stable), or late (RS rank peaking and rolling over).

Example prompt:
> "Give me a deep dive on the Capital Goods sector. Which stocks should be on my watchlist?"

### Stage Transition Monitoring

Stocks transitioning from Stage 1 (basing) to Stage 2 (advancing) are among the best swing trades. The entry is early, before most participants notice, and the risk/reward is at its highest. Scan for them using `stage2_entry` or by filtering `indicators_daily` directly:

```
stage = 2 AND price_percentile_52w BETWEEN 50 AND 65 AND pct_from_ema200 BETWEEN 0 AND 5
```

This finds stocks that just crossed above their SMA200 from below — the exact moment a Stage 1 base resolves into a Stage 2 advance.

Example prompt:
> "Find stocks that appear to have just entered Stage 2 from Stage 1 in the past 2 weeks — recent SMA200 breakout with volume confirmation."

### Backtest Before Deploying a New Screen

Before acting on a new scan or screen you've been watching, use `nse_backtest` to replay it against 1–2 years of historical data. The output includes win rate, expectancy, average holding period, and max drawdown — sliced by NIFTY regime at the time of entry. A screen with a 1.4 Sharpe in Stage 2 markets and a 0.3 Sharpe in Stage 4 markets tells you something important: only deploy it when the regime supports it.

Example prompt:
> "Backtest the base_breakout scan from 2024-01-01 to 2024-12-31. 10-day hold, 2x ATR stop. Show me regime-sliced results."
