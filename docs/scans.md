# Scan Library

Scans are pre-built SQL filters that run against `indicators_daily` for any date and universe. They are the fastest way to find tradeable stocks — instead of analyzing 500 stocks individually, a scan returns only the ones matching specific conditions. Scans are stored in the `saved_scans` table (seeded from the `scans/` folder at init) and run via the `nse_run_scan` tool.

---

## How Scans Work

```
nse_run_scan({
  scan_id: "52w_high_breakout",
  universe: "nifty500",     // 'watchlist' | 'nifty50' | 'nifty500' | 'all'
  date: "2026-05-25",       // defaults to latest available date
  limit: 50                 // max results returned
})
```

Results are returned sorted by `composite_score` DESC — highest conviction matches first. Each result includes: symbol, name, sector, cap_band, close, composite_score, sniper_score, setup_type, and the key metrics that triggered the scan.

The `scan_density` section of `nse_market_brief` shows how many stocks in the universe matched each major scan today — giving an instant read on market opportunity density.

---

## Adding Custom Scans

Create a `.json` file in the `scans/` folder with this format and run `refresh-scans`:

```json
{
  "scan_id": "my_custom_scan",
  "name": "My Custom Screen",
  "category": "custom",
  "description": "Description of what this finds",
  "sql_template": "rsi_14 > 60 AND rvol >= 1.5 AND stage = 2",
  "tags": ["bullish", "custom"]
}
```

The `sql_template` is a SQL WHERE clause fragment referencing any column in `indicators_daily` joined with `instruments`.

---

## Scan Library

### Breakout Scans

| Scan ID | What it finds |
|---|---|
| `52w_high_breakout` | New 52-week high with volume (dist_52wk_high_pct ≤ 1%, rvol ≥ 1.5). Stocks breaking into new territory. |
| `52w_high_vol_spike` | Same as above but stronger volume surge (rvol ≥ 2.0). Higher conviction breakouts. |
| `ath_breakout` | Breaking to all-time highs (dist_ath_pct ≤ 0.5%, rvol ≥ 1.5). No overhead resistance — cleanest breakout signal. |
| `sma200_breakout` | Price crossing above SMA200 (pct_from_ema200 between 0–2%, rvol ≥ 1.2). Stage 1→2 transition signal. |
| `vwap_breakout` | Strong close above VWAP with volume surge (rvol ≥ 2.0, return_1d > 1.5%). Intraday institutional buying confirmed at close. |
| `donchian_breakout` | Price at 20-day high with volume. Mechanical channel breakout. |
| `keltner_breakout` | Price breaking above Keltner upper channel. Often follows a Bollinger squeeze. |
| `3m_high_breakout` | Stock at its best 3-month relative performance level with volume. Momentum leadership. |
| `stage2_entry` | Recently entered Stage 2 (stage = 2, ma_stack = 4, within 10% of 52W high). Fresh uptrend entry. |

### Momentum Scans

| Scan ID | What it finds |
|---|---|
| `bullish_rsi_zone` | RSI between 50–70. Broad momentum filter — thousands of stocks often match this. Combine with other filters. |
| `rsi_oversold_bounce` | RSI < 35 but MACD histogram turning positive. Oversold with early momentum recovery. |
| `macd_bullish_cross` | MACD histogram just turned positive (macd_hist > 0 AND macd_hist_prev ≤ 0). Fresh momentum signal. |
| `adx_bullish_trend` | ADX > 25, +DI > −DI. Stock in a confirmed directional uptrend. |
| `momentum_surge` | RSI > 60, rvol ≥ 1.5, return_1w > 3%. Stocks with broad momentum acceleration. |
| `golden_cross` | EMA50 above EMA200 with positive EMA50 slope. Stocks in golden cross state with trend supporting. |
| `psar_flip_bullish` | Parabolic SAR flipped bullish today (psar_signal = 1 AND psar_signal_prev = −1). Trend reversal signal. |

### Setup Scans

These scans directly query the pre-classified `setup_type` column — fastest way to find tradeable setups.

| Scan ID | What it finds |
|---|---|
| `base_breakout` | All stocks classified as `setup_type = 'base_breakout'`. Coiled springs near 52W highs. |
| `pullback_to_ema` | Stocks in either `pullback_to_ema20` or `pullback_to_ema50` setup. Low-risk re-entry points in uptrends. |
| `high_quality_setups` | Any setup_type with setup_quality ≥ 75 AND sniper_score ≥ 6. High conviction only. |
| `stage2_momentum` | Stage 2 stocks with tf_alignment_score ≥ 2 and rs_rank_in_segment ≥ 65. Strong stocks in strong trends. |

### Reversal Scans

| Scan ID | What it finds |
|---|---|
| `oversold_bounce` | RSI < 35, near 52W low, MACD histogram improving. Potential bounce candidates. |
| `bearish_exhaustion` | RSI > 75, RVOL < 0.8. Extended move with volume drying up — potential top. For exits/short watch. |
| `candle_reversal_bull` | Bullish reversal candle (hammer/engulf/morning_star/dragonfly_doji) at oversold RSI < 45. |
| `stage1_emerging` | Stage 1 stocks with rs_rank_in_segment ≥ 60. Basing near SMA200 but with relative strength — potential Stage 2 candidates. |

### Volume Scans

| Scan ID | What it finds |
|---|---|
| `vol_2x_avg` | Volume at least 2× 20-day average today (rvol ≥ 2.0). Something is happening — determine direction. |
| `strong_money_inflow` | rvol ≥ 1.5, positive day (return_1d > 1.5%), closed above VWAP. Institutional accumulation on the day. |
| `delivery_surge` | Delivery % > 1.5× its 20-day average AND positive day. NSE-specific: physical delivery surge = institutional accumulation. |
| `vol_dry_up` | RVOL < 0.5, price near EMA50 (within 5%). Volume contraction during consolidation — coiling for move. |
| `smart_money_candidates` | delivery_pct > delivery_ma_20 × 1.3 OR rvol ≥ 1.5 (and vol_sma_20 is valid). Pre-filter for smart money skill analysis. Run this first, then ask the agent to classify accumulation vs distribution. |

### Relative Strength Scans

| Scan ID | What it finds |
|---|---|
| `rs_leaders` | rs_rank_in_segment ≥ 80. Top 20% performers in their cap band. |
| `rs_improving` | rs_rank_in_segment ≥ 60 AND rs_vs_broad > 0. Outperforming and showing positive momentum vs the broad market. |
| `cap_rotation` | rs_vs_broad > 3 AND market_cap_band = 'mid'. Mid caps outperforming large caps by 3%+ — cap rotation signal. |

### Top Performer Scans

| Scan ID | What it finds |
|---|---|
| `ytd_leaders` | return_ytd > 20% AND rs_rank_in_segment ≥ 75. Stocks leading the year — institutions are rewarding these. |
| `top_3m_performers` | return_3m > 15% AND rs_rank_in_segment ≥ 70. Strong 3-month momentum with RS confirmation. |
| `1yr_stars` | return_1y > 30% AND dist_52wk_high_pct ≤ 10%. Annual leaders still near their highs — sustained strength. |
| `strong_money_inflow_30d` | avg_dollar_volume_20 > ₹5 crore AND return_1m > 5%. Liquid stocks with sustained institutional interest. |

---

## Scan Combination Workflow

For highest conviction results, combine scans in sequence:

**Finding the best breakout candidates:**
1. Run `stage2_entry` to find recent Stage 2 entrants
2. Filter results by sector (use top rotating sector from market-brief)
3. Further filter by `rs_rank_in_segment >= 65`
4. Ask agent to explain setup quality for top 5 results

**Finding smart money accumulation:**
1. Run `smart_money_candidates` to pre-filter (~50–100 stocks)
2. Ask agent: "Analyze these stocks for smart money accumulation vs distribution"
3. Agent reads delivery_pct, close_position_ratio, obv_slope_5d, rvol and classifies

**Daily opportunity scan:**
1. Check `scan_density` in `nse_market_brief` — which categories have the most hits today?
2. If `pullback_to_ema50` density is high (> 15 stocks) in a bull regime = broad re-entry opportunity
3. If `breakout_confirmed` density is high = breakout day — active scanning warranted
4. If all densities low = quiet market, reduce trading activity
