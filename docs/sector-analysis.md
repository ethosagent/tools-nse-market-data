# Sector Analysis & Rotation

Sector rotation is the movement of institutional money between sectors of the market. Being in the right sector at the right time is the highest-leverage decision in swing trading — more impactful than individual stock selection within the sector. This tool tracks 16 sector indexes and computes daily sector metrics in `sector_state_daily`.

---

## Tracked Sector Indexes

| Symbol | Sector |
|---|---|
| `^NSEBANK` | Banking |
| `^CNXIT` | Information Technology |
| `^CNXAUTO` | Automobiles |
| `^CNXPHARMA` | Pharmaceuticals |
| `^CNXFMCG` | FMCG / Consumer Staples |
| `^CNXMETAL` | Metals & Mining |
| `^CNXENERGY` | Energy |
| `^CNXREALTY` | Real Estate |
| `^CNXFINANCE` | Financial Services |
| `^CNXPSUBANK` | PSU Banks |
| `^CNXCAPGOODS` | Capital Goods |

---

## Sector State Columns

### Returns

| Column | Description |
|---|---|
| `sector_return_1d` | Today's sector index return |
| `sector_return_1w` | 5-day return |
| `sector_return_1m` | 21-day return |
| `sector_return_3m` | 63-day return — primary RS ranking input |
| `sector_return_6m` | 126-day return |
| `sector_return_ytd` | Year-to-date return |

### Relative Strength

| Column | Description |
|---|---|
| `rs_rank` | REAL 0–100. Sector's RS rank vs all other tracked sectors. 90 = sector is in top 10% of all sectors by 3-month relative performance. Updated daily. |
| `rs_rank_prev_week` | `rs_rank` from 5 trading days ago |
| `rs_rank_delta_1w` | `rs_rank` − `rs_rank_prev_week`. Positive = sector gaining ground. Negative = losing. |
| `rotation_signal` | `'improving'` if delta > 5, `'deteriorating'` if delta < −5, `'stable'` otherwise |

### Member Breadth

| Column | Description |
|---|---|
| `pct_members_uptrend` | % of the sector's constituent stocks with close > EMA50. > 65% = broadly bullish sector. < 40% = broad weakness. |
| `pct_members_stage2` | % of constituents in Weinstein Stage 2. High = institutional participation deep in the sector. |
| `advances` | Count of sector members that advanced today |
| `declines` | Count that declined |
| `breadth_pct` | advances / (advances + declines) × 100 |
| `avg_member_rs` | Average `rs_vs_broad` of all sector members. High = sector stocks as a group are outperforming the broad market. |
| `avg_member_composite` | Average composite_score of sector members. High = sector is filled with high-scoring stocks. |

### Top Stock

| Column | Description |
|---|---|
| `top_stock_symbol` | The sector member with the highest composite_score today — the leader |
| `top_stock_return_1d` | Today's return of the sector leader |

---

## Identifying Sector Rotation

**Step 1 — Find the sectors with improving RS:**
Sort `sector_state_daily` by `rs_rank_delta_1w DESC` for today's date. The top 3 sectors are rotating into favor.

**Step 2 — Confirm with member breadth:**
`rotation_signal = 'improving'` AND `pct_members_uptrend > 55%` AND `pct_members_stage2 > 40%` = institutional rotation confirmed, not just index-level.

**Step 3 — Check duration:**
Look at the last 4 weeks of `rs_rank` for the sector. Rank improving steadily over 3+ weeks = sustained rotation. Single-week spike = noise.

**Step 4 — Find the leader within the sector:**
Run `stage2_momentum` or `rs_leaders` scan filtered to the sector. Sort by `composite_score`. The `top_stock_symbol` column points to today's sector leader.

---

## Rotation Patterns

**Offensive rotation** (risk-on): Money flows from Pharma/FMCG (defensive) → IT/Capital Goods/Financials (cyclical). Signals: rs_rank improving for cyclicals, deteriorating for defensives. Bullish for broader market.

**Defensive rotation** (risk-off): Money flows from cyclicals → Pharma/FMCG/PSU Bank. Signals: opposite of above. Bearish signal for overall market.

**Broad participation**: All sectors above 70 `pct_members_uptrend`. Indicates a strong bull market phase with no obvious rotation — everything working.

**Narrow leadership**: Only 2–3 sectors with `rs_rank > 70`, rest < 40. Late-cycle bull market warning — breadth narrowing.

---

## `nse_market_brief` Sector Output

The `top_sectors` section of `nse_market_brief` shows the top sectors sorted by `rs_rank` with all key metrics in one view:

```json
{
  "sector": "Capital Goods",
  "index": "^CNXCAPGOODS",
  "return_1w": 2.7,
  "return_1m": 5.5,
  "rs_rank": 88,
  "rs_rank_delta_1w": 14,
  "pct_members_uptrend": 72.0,
  "pct_members_stage2": 60.0,
  "avg_member_rs": 4.2,
  "top_stock": "ELECON",
  "rotation_signal": "improving"
}
```
