# Skill: Chart OHLCV

## Purpose
Render a matplotlib/mplfinance candlestick chart for any NSE stock, annotated with whatever the agent knows from prior analysis (trade levels, indicators, scan signals, free-form user input). Invoke this skill when the user says "show chart", "plot", "visualize", or "chart", or when another skill (`trade_setup`, `stock_deep_analysis`) requests a visual summary.

## System Prompt
You are a chart renderer. Your job is to faithfully translate prior analysis into a well-annotated visual. You do not re-analyse the stock — you take what is already known (trade levels, scan signals, indicator values, user-supplied prices) and encode it into a chart that a trader can act on at a glance. Every horizontal line must be labeled with its meaning and price. Every marker must be unambiguous. If no prior analysis has run, render the plain price chart with MA overlays — that is still useful.

## Instructions

### Step 0 — Prerequisites

Verify Python is available. Check for the chart venv first:

```
ls ~/.ethos/tools/chart-venv/bin/python 2>/dev/null && echo "venv ready" || python3 --version 2>&1
```

If neither is found, stop and reply:

```
**Python not found.** Install Python 3: https://www.python.org/downloads/
```

The script auto-installs pandas/matplotlib/mplfinance into the venv if needed.

---

### Step 1 — Collect analysis context (optional)

If prior analysis is available (trade_setup, stock_deep_analysis, scan results), collect the price levels, signals, and annotations. If not, the chart renders with just MA overlays — that is still useful.

Call `nse_market_indicators` with the symbol and days if you need indicator values for annotations. This is optional — the chart script computes MAs directly from OHLCV data in the database.

---

### Step 2 — Build the ANNOTATIONS dict

Construct the following dict from everything the agent knows at chart generation time. When a source is not available, leave the corresponding list empty — the chart still renders.

#### `hlines` — horizontal price lines

Populate from any available source:

| Source | Key to read | Label to use |
|---|---|---|
| `trade_setup` output | `entry_zone.low` | `Entry` |
| `trade_setup` output | `stop_loss` | `Stop` |
| `trade_setup` output | `target_1` | `T1` |
| `trade_setup` output | `target_2` | `T2` |
| `stock_deep_analysis` output | support level | `Support` |
| `stock_deep_analysis` output | resistance level | `Resistance` |
| `nse_market_indicators` latest row | `high_52w` | `52W High` |
| User freeform input | any price the user names | as stated |

Color convention:

| Role | Color |
|---|---|
| Stop Loss / Resistance | `red` |
| Support / Target | `green` |
| Entry | `blue` |
| User-specified / neutral | `orange` |

#### `vlines` — vertical date lines

Populate from scan signal dates or user-specified dates.

#### `markers` — buy/sell arrows on candles

Populate from scan signals or explicit entry/exit points.

#### `labels` — free text annotations

Use for ATH zone labels, stage labels, or anything that does not fit a line.

---

### Step 3 — Write the Python script

Write the script to `/tmp/ethos_chart_{symbol_clean}.py` where `symbol_clean` is the symbol with `.` replaced by `_`.

The agent fills in THREE variables at the top:
- `SYMBOL` — the NSE symbol string
- `DAYS` — integer number of days
- `ANNOTATIONS` — the dict from Step 2

The script reads OHLCV data directly from the SQLite database. Do not pass OHLCV or indicator data as Python literals.

**Everything below the agent variables is fixed template code. Do not modify it.**

```python
import os, sqlite3
import pandas as pd
import mplfinance as mpf
import matplotlib
matplotlib.use('Agg')

# ── Agent fills these in ──────────────────────────────────────────────────────
SYMBOL = "RELIANCE.NS"
DAYS = 90
ANNOTATIONS = {
    "hlines":  [],  # {"price": float, "label": str, "color": str, "ls": str}
    "vlines":  [],  # {"date": str, "label": str}
    "markers": [],  # {"date": str, "price": float, "type": "buy"|"sell"}
    "labels":  [],  # {"date": str, "price": float, "text": str, "color": str}
    "mas":     ["sma20", "sma50"],
}
# ─────────────────────────────────────────────────────────────────────────────

SAVE_PATH = f"/tmp/ethos_chart_{SYMBOL.replace('.', '_')}.png"
DB = os.path.expanduser('~/.ethos/market-data/market.db')
conn = sqlite3.connect(DB)
df = pd.read_sql_query(
    "SELECT date, open, high, low, close, volume FROM ohlcv_daily WHERE symbol = ? ORDER BY date DESC LIMIT ?",
    conn, params=[SYMBOL, DAYS]
).iloc[::-1].copy()
conn.close()

if df.empty:
    print(f"ERROR: No OHLCV data for {SYMBOL}")
    exit(1)

df.columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
df['Date'] = pd.to_datetime(df['Date'])
df = df.set_index('Date')

# MA overlays
COLOR_MAP = {"sma20": "blue", "sma50": "orange", "sma200": "purple", "ema21": "green", "ema9": "gray"}
addplots = []
for key in ANNOTATIONS.get("mas", []):
    s = None
    if key.startswith("sma"):
        period = int(key[3:])
        s = df['Close'].rolling(window=period).mean()
    elif key.startswith("ema"):
        period = int(key[3:])
        s = df['Close'].ewm(span=period, adjust=False).mean()
    if s is not None and s.notna().any():
        addplots.append(mpf.make_addplot(s, color=COLOR_MAP.get(key, 'gray'), width=1))

# Buy/sell markers
for m in ANNOTATIONS.get("markers", []):
    s = pd.Series(dtype=float, index=df.index)
    dt = pd.to_datetime(m["date"])
    if dt in s.index:
        s[dt] = float(m["price"])
        color = "green" if m["type"] == "buy" else "red"
        marker = "^" if m["type"] == "buy" else "v"
        addplots.append(mpf.make_addplot(s, type='scatter', markersize=120, marker=marker, color=color))

# Horizontal lines via mplfinance built-in
hline_prices = [h["price"] for h in ANNOTATIONS.get("hlines", [])]
hline_colors = [h.get("color", "gray") for h in ANNOTATIONS.get("hlines", [])]
hlines_kwarg = dict(hlines=hline_prices, colors=hline_colors, linestyle='--') if hline_prices else {}

# Plot
fig, axes = mpf.plot(
    df, type='candle', volume=True,
    addplot=addplots if addplots else None,
    returnfig=True, figsize=(13, 7), tight_layout=True,
    title=f'\n{SYMBOL}  ·  {DAYS}d',
    **hlines_kwarg,
)
ax = axes[0]

# Label horizontal lines on right edge
for hl in ANNOTATIONS.get("hlines", []):
    ax.text(df.index[-1], hl["price"], f'  {hl["label"]} {hl["price"]:.1f}',
            color=hl.get("color", "gray"), fontsize=8, va='center', ha='left',
            clip_on=False, fontfamily='monospace')

# Vertical date lines
for vl in ANNOTATIONS.get("vlines", []):
    dt = pd.to_datetime(vl["date"])
    if df.index.min() <= dt <= df.index.max():
        ax.axvline(x=dt, color='gray', linestyle='--', linewidth=1, alpha=0.7)
        ylim = ax.get_ylim()
        ax.text(dt, ylim[1] * 0.995, f' {vl["label"]}',
                color='gray', fontsize=7, va='top', rotation=90, fontfamily='monospace')

# Free text labels
for lbl in ANNOTATIONS.get("labels", []):
    ax.text(pd.to_datetime(lbl["date"]), float(lbl["price"]), lbl["text"],
            color=lbl.get("color", "gray"), fontsize=8, ha='center', fontfamily='monospace',
            bbox=dict(boxstyle='round,pad=0.2', facecolor='#FFFFCC', alpha=0.8, edgecolor='none'))

fig.savefig(SAVE_PATH, dpi=130, bbox_inches='tight')
print(f"Chart saved to {SAVE_PATH}")
```

---

### Step 4 — Execute

Determine the Python binary:

```
PYTHON=$([ -x ~/.ethos/tools/chart-venv/bin/python ] && echo ~/.ethos/tools/chart-venv/bin/python || echo python3)
$PYTHON /tmp/ethos_chart_{symbol_clean}.py
```

If exit code is non-zero, show the full error and stop.

---

### Step 5 — Return the chart

Reply with the saved file path and open it:

```
open /tmp/ethos_chart_{symbol_clean}.png
```

Then on a new line, a single sentence summarising what is marked on the chart, for example:
> Levels marked: Entry 2320 · Stop 2250 · T1 2600 · Support 2180 · Resistance 2450

List only the levels that are actually present in `ANNOTATIONS.hlines`. If `hlines` is empty, omit the summary line entirely.

## Data Context

`{{nse_market_indicators}}` — optional. Indicator rows for the symbol. Used only to populate annotation values (support, resistance, 52W high, etc.), not for chart data. The script reads OHLCV directly from the database.

`{{trade_setup}}` — optional. If available, its `entry_zone.low`, `stop_loss`, `target_1`, and `target_2` fields populate `hlines` automatically.

`{{stock_deep_analysis}}` — optional. If available, its support and resistance levels populate `hlines` automatically.
