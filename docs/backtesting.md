# Backtesting Guide

Run any scan or custom screen over historical data to measure win rate, expectancy, and alpha vs benchmark.

## How it works

1. The backtester walks through every trading day in your date range
2. On each day, it finds all stocks matching your scan condition
3. For each match, it enters at next day's open
4. It exits on either: ATR-based stop loss hit, or hold period expiry (whichever comes first)
5. It tracks every trade and computes summary stats + benchmark comparison

## CLI usage

```bash
# Backtest a saved scan
nse-market-data backtest --scan-id stage2_momentum --from 2025-01-01 --to 2026-06-01

# Backtest with custom hold period and stop
nse-market-data backtest --scan-id base_breakout --from 2025-01-01 --to 2026-06-01 --hold-days 30 --stop-atr-mult 2.5

# Backtest a custom screen (inline WHERE clause)
nse-market-data backtest --screen "stage = 2 AND rsi_14 > 55 AND rvol >= 1.5" --from 2025-01-01 --to 2026-06-01

# Compare against a different benchmark
nse-market-data backtest --scan-id momentum_surge --from 2025-01-01 --to 2026-06-01 --benchmark ^NSEI
```

## LLM tool usage

```typescript
nse_backtest({
  scan_id: "stage2_momentum",
  from: "2025-01-01",
  to: "2026-06-01",
  hold_days: 30,
  stop_atr_mult: 2.0,
  benchmark: "^CRSLDX"
})
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--scan-id` | — | Saved scan ID (e.g. `stage2_momentum`, `base_breakout`) |
| `--screen` | — | Inline WHERE clause (alternative to scan-id) |
| `--from` | required | Start date YYYY-MM-DD |
| `--to` | required | End date YYYY-MM-DD |
| `--hold-days` | 10 | Max trading days to hold each position |
| `--stop-atr-mult` | 2.0 | Stop loss = entry - (ATR × multiplier) |
| `--benchmark` | ^CRSLDX | Index to compare alpha against |

## Output

### Per-trade detail

Each trade includes:

| Field | Description |
|-------|-------------|
| `symbol` | Stock symbol |
| `signal_date` | Date the scan matched |
| `entry_date` | Next trading day (entry at open) |
| `entry_price` | Opening price on entry day |
| `exit_date` | Date position was closed |
| `exit_price` | Price at exit |
| `exit_reason` | `stop` (ATR stop hit) or `time` (hold days expired) |
| `pnl_pct` | Profit/loss as percentage |
| `holding_days` | Actual days held |
| `setup_type` | Classified setup type at signal |
| `sniper_score` | Quality score at signal |
| `regime_stage` | Nifty stage at signal (market context) |

### Summary stats

| Metric | Description |
|--------|-------------|
| `total_trades` | Number of trades taken |
| `win_rate` | Percentage of profitable trades |
| `avg_gain_wins` | Average gain on winning trades (%) |
| `avg_loss` | Average loss on losing trades (%) |
| `expectancy` | Expected return per trade (%) |
| `max_drawdown` | Worst peak-to-trough decline (%) |
| `sharpe_approx` | Approximate Sharpe ratio |
| `benchmark_return` | Benchmark return over the same period (%) |
| `screen_alpha` | Strategy return minus benchmark return (%) |
| `avg_hold` | Average holding period in days |

### By-regime breakdown

Results are also split by Nifty stage at signal time, so you can see how the scan performs in different market environments (Stage 1 = accumulation, Stage 2 = uptrend, Stage 3 = distribution, Stage 4 = downtrend).

## Available scans for backtesting

List all scans:

```bash
nse-market-data scan --list
```

### Key scans by style

**Minervini / momentum breakout:**
- `stage2_momentum` — Stage 2 with perfect MA alignment and composite score >= 65
- `base_breakout` — Tight base near highs, Stage 2 setup
- `52w_high_breakout` — Near 52-week high with volume surge

**Momentum:**
- `momentum_surge` — Strong 1-month return with high volume
- `golden_cross` — SMA 50 above SMA 200 with price above both
- `adx_bullish_trend` — ADX > 25 with +DI leading

**Relative strength:**
- `rs_leaders` — Top RS in their cap segment
- `rs_improving` — RS rank improving over recent period

**Reversal:**
- `oversold_bounce` — RSI < 30 turning up
- `stage1_emerging` — Transitioning from Stage 4 to Stage 1

## Writing custom scans

A scan is a JSON file in `scans/<category>/`:

```json
{
  "scan_id": "my_custom_scan",
  "name": "My Custom Scan",
  "category": "setup",
  "description": "What this scan looks for",
  "sql_template": "stage = 2 AND rsi_14 > 50 AND rvol >= 1.5",
  "tags": ["bullish", "custom"]
}
```

The `sql_template` is a WHERE clause fragment that runs against `indicators_daily` joined with `ohlcv_daily` and `instruments`. It auto-filters to latest date, active equities only.

### Available columns

**Trend:**
`stage`, `ma_stack`, `ema_50_slope`, `psar_signal`, `tf_alignment_score`

**Momentum:**
`rsi_14`, `macd_hist`, `adx`, `adx_di_plus`, `adx_di_minus`, `stoch_k`, `stoch_d`, `cci_20`, `roc_5`

**Moving averages:**
`ema_20`, `ema_50`, `ema_100`, `ema_200`, `sma_50`, `sma_200`, `pct_from_ema20`, `pct_from_ema50`, `pct_from_ema200`

**Volume:**
`rvol`, `vol_sma_20`, `obv_slope_5d`, `closed_above_vwap`, `delivery_pct`

**Volatility:**
`atr_14`, `bb_width`, `adr_pct`

**Returns:**
`return_1d`, `return_1w`, `return_1m`, `return_3m`, `return_6m`, `return_1y`

**Relative strength:**
`rs_vs_segment`, `rs_vs_broad`, `rs_rank_in_segment`, `rs_rank_in_sector`

**Scores:**
`sniper_score`, `composite_score`, `setup_type`, `setup_quality`

**Base/pattern:**
`base_pattern`, `base_depth_pct`, `base_quality_score`, `pivot_price`, `near_pivot`

**Price position:**
`dist_52wk_high_pct`, `dist_52wk_low_pct`, `price_percentile_52w`

**Multi-timeframe:**
`close_vs_ema20w`, `close_vs_ema50w`, `close_vs_ema10m`, `rsi_14_weekly`

### After creating a scan

```bash
# Reload scans into the database
nse-market-data refresh-scans

# Test it
nse-market-data scan my_custom_scan

# Backtest it
nse-market-data backtest --scan-id my_custom_scan --from 2025-01-01 --to 2026-06-01 --hold-days 20
```

## Example: Minervini-style backtest

Mark Minervini's criteria: Stage 2 trend, tight volatility contraction, relative strength leader, volume confirmation.

```bash
# Use the built-in Stage 2 momentum scan
nse-market-data backtest --scan-id stage2_momentum --from 2025-01-01 --to 2026-06-01 --hold-days 30 --stop-atr-mult 2.0

# Or create a stricter Minervini VCP scan
cat > scans/setup/minervini_vcp.json << 'EOF'
{
  "scan_id": "minervini_vcp",
  "name": "Minervini VCP Setup",
  "category": "setup",
  "description": "Volatility contraction in Stage 2 with strong RS and tight base",
  "sql_template": "stage = 2 AND base_pattern IS NOT NULL AND base_depth_pct < 20 AND rs_rank_in_segment > 70 AND ma_stack >= 3 AND rvol >= 1.0 AND composite_score >= 60",
  "tags": ["bullish", "minervini", "vcp", "base"]
}
EOF
nse-market-data refresh-scans
nse-market-data backtest --scan-id minervini_vcp --from 2025-01-01 --to 2026-06-01 --hold-days 30

# Compare base breakout vs momentum surge
nse-market-data backtest --scan-id base_breakout --from 2025-01-01 --to 2026-06-01 --hold-days 20
nse-market-data backtest --scan-id momentum_surge --from 2025-01-01 --to 2026-06-01 --hold-days 20
```

## Tips

- **Shorter hold periods** (5-10 days) suit momentum/breakout scans
- **Longer hold periods** (20-30 days) suit base/VCP setups
- **Tighter stops** (1.5× ATR) reduce losses but increase false exits
- **Wider stops** (2.5-3× ATR) give trades room but risk larger losses
- **Check by-regime breakdown** — a scan that works in Stage 2 markets may fail in Stage 4
- **Compare vs benchmark** — alpha matters more than raw returns
- **Win rate isn't everything** — a 40% win rate with 3:1 reward:risk is highly profitable
