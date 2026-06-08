# Skill: Chart OHLCV

## Purpose
Render a matplotlib/mplfinance candlestick chart for any NSE stock, annotated with whatever the agent knows from prior analysis (trade levels, indicators, scan signals, free-form user input). Invoke this skill when the user says "show chart", "plot", "visualize", or "chart", or when another skill (`trade_setup`, `stock_deep_analysis`) requests a visual summary.

## System Prompt
You are a chart renderer. Your job is to faithfully translate prior analysis into a well-annotated visual. You do not re-analyse the stock — you take what is already known (trade levels, scan signals, indicator values, user-supplied prices) and encode it into a chart that a trader can act on at a glance. Every horizontal line must be labeled with its meaning and price. Every marker must be unambiguous. If no prior analysis has run, render the plain price chart with MA overlays — that is still useful.

## Instructions

### Step 0 — Prerequisites

Run via the `terminal` tool:
```
python3 --version 2>&1
```

If `python3` is not found, stop and reply:

```
**Python not found.** Install Python 3: https://www.python.org/downloads/
```

Do not check for pandas/matplotlib/mplfinance here — the script installs them automatically.

---

### Step 1 — Collect data

Call `nse_market_history` with:
- `symbol`: the NSE symbol (e.g. `RELIANCE.NS`)
- `days`: 90 by default, or the period the user requests

Call `nse_market_indicators` with the same `symbol` and the same `days`. This is needed for MA series and PSAR overlays. Skip this call **only** if the user explicitly asks for a plain price chart with no indicators.

If either tool returns an error or empty data, stop and surface the error message verbatim. Do not attempt to generate a chart with missing data.

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
| `nse_market_indicators` latest row | `ath` | `ATH` |
| `nse_market_indicators` latest row | `sma_200` | `SMA200 now` |
| User freeform input | any price the user names | as stated |

Color convention — pick based on role relative to current price:

| Role | Color hex |
|---|---|
| Stop Loss or Resistance above current price | `#F87171` (red) |
| Support below current price or Target | `#4ADE80` (green) |
| Entry | `#4A9EFF` (blue) |
| User-specified / neutral | `#F59E0B` (amber) |

Line style (`ls`): use `"--"` for most levels; use `"-"` for entry.

#### `vlines` — vertical date lines

Populate from:
- The date of a scan signal that triggered this analysis
- Any date the user explicitly calls out (e.g. "mark the breakout on March 15")

Use `"#9A9A98"` (grey) as the default color.

#### `markers` — buy/sell arrows on candles

Populate from:
- Scan signal candle: set `type` to `"buy"` or `"sell"`, date to signal date, price to the close on that date
- Any explicit entry or exit point the user mentions

#### `mas` — MA overlays

Default to `["sma20", "sma50", "sma200", "ema21"]`. Remove any MA name for which no corresponding column exists in the indicator rows. Honor user overrides (e.g. "show EMA9 instead of EMA21").

#### `psar` — Parabolic SAR scatter

Default to `true`. Set to `false` if the user says "no PSAR" or if the indicator data does not contain a `psar` column.

#### `labels` — free text annotations

Use for ATH zone labels, stage labels, or anything that does not fit a horizontal or vertical line. Each entry needs `date`, `price`, `text`, and optionally `color`.

---

### Step 3 — Write the Python script

Use bash to write the script below to `/tmp/ethos_chart_{symbol_clean}.py` where `symbol_clean` is the symbol with `.` replaced by `_` (e.g. `RELIANCE_NS`).

The agent fills in four variables at the top of the script:
- `SYMBOL` — the NSE symbol string
- `DAYS` — integer number of days requested
- `OHLCV_ROWS` — list of tuples `(date_str, open, high, low, close, volume)` from `nse_market_history` output, oldest row first
- `INDICATOR_ROWS` — list of dicts from `nse_market_indicators` output (the JSON rows), oldest row first. Use `[]` if indicators were not fetched.
- `ANNOTATIONS` — the dict built in Step 2

**Everything else in the script is fixed template code. Do not modify it.**

```python
import importlib, shutil, subprocess, sys

# ── Auto-install dependencies ─────────────────────────────────────────────────
def _ensure(*packages):
    missing = [p for p in packages if not _importable(p)]
    if not missing:
        return
    # Try pip
    r = subprocess.run(
        [sys.executable, '-m', 'pip', 'install', '--quiet'] + missing,
        capture_output=True,
    )
    if r.returncode == 0:
        return
    # Fall back to uv (handles externally-managed environments)
    uv = shutil.which('uv') or shutil.which(
        str(__import__('pathlib').Path.home() / '.local' / 'bin' / 'uv')
    )
    if uv:
        subprocess.check_call([uv, 'pip', 'install', '--system'] + missing, stderr=subprocess.DEVNULL)
        return
    raise RuntimeError(
        f"Cannot install {missing}.\n"
        "Install uv (https://docs.astral.sh/uv/) or run: pip install " + ' '.join(missing)
    )

def _importable(pkg):
    try:
        importlib.import_module(pkg)
        return True
    except ImportError:
        return False

_ensure('pandas', 'matplotlib', 'mplfinance')
# ─────────────────────────────────────────────────────────────────────────────

import io, base64
import pandas as pd
import mplfinance as mpf
import matplotlib
matplotlib.use("Agg")

# ── Agent fills these in ──────────────────────────────────────────────────────
SYMBOL = "RELIANCE.NS"
DAYS   = 90
OHLCV_ROWS = [
    # ("2024-01-02", 2300.0, 2350.0, 2280.0, 2320.0, 1234567),
]
INDICATOR_ROWS = [
    # {"date": "2024-01-02", "sma_20": 2290.0, "sma_50": 2250.0, ...}
]
ANNOTATIONS = {
    "hlines":  [],  # {"price": float, "label": str, "color": str, "ls": str}
    "vlines":  [],  # {"date": str, "label": str, "color": str}
    "markers": [],  # {"date": str, "price": float, "type": "buy"|"sell", "label": str}
    "mas":     ["sma20", "sma50", "sma200", "ema21"],
    "psar":    True,
    "labels":  [],  # {"date": str, "price": float, "text": str, "color": str}
}
# ─────────────────────────────────────────────────────────────────────────────

# Build main DataFrame
df = pd.DataFrame(OHLCV_ROWS, columns=["Date","Open","High","Low","Close","Volume"])
df["Date"] = pd.to_datetime(df["Date"])
df = df.set_index("Date").sort_index()

# Build indicator DataFrame
idf = pd.DataFrame(INDICATOR_ROWS) if INDICATOR_ROWS else pd.DataFrame()
if not idf.empty and "date" in idf.columns:
    idf["Date"] = pd.to_datetime(idf["date"])
    idf = idf.set_index("Date").sort_index()

# MA overlays — computed from OHLCV Close so they always extend to today
COLOR_MAP = {"sma20":"#4A9EFF","sma50":"#F59E0B","sma200":"#E879F9","ema21":"#4ADE80","ema9":"#94A3B8"}
addplots = []
for key in ANNOTATIONS.get("mas", []):
    s = None
    if key.startswith("sma"):
        period = int(key[3:])
        s = df["Close"].rolling(window=period).mean()
    elif key.startswith("ema"):
        period = int(key[3:])
        s = df["Close"].ewm(span=period, adjust=False).mean()
    if s is not None and s.notna().any():
        addplots.append(mpf.make_addplot(s, color=COLOR_MAP.get(key, "#9A9A98"), width=1.2, label=key))

# PSAR scatter
if ANNOTATIONS.get("psar") and not idf.empty and "psar" in idf.columns:
    s = idf["psar"].reindex(df.index)
    if s.notna().any():
        addplots.append(mpf.make_addplot(s, type="scatter", markersize=18, marker=".", color="#F59E0B"))

# Buy/sell markers
for m in ANNOTATIONS.get("markers", []):
    s = pd.Series(dtype=float, index=df.index)
    dt = pd.to_datetime(m["date"])
    if dt in s.index:
        s[dt] = float(m["price"])
        color  = "#4ADE80" if m["type"] == "buy" else "#F87171"
        marker = "^"       if m["type"] == "buy" else "v"
        addplots.append(mpf.make_addplot(s, type="scatter", markersize=120, marker=marker, color=color))

# Plot
_mc = mpf.make_marketcolors(
    up="#4ADE80", down="#F87171",
    edge="inherit", wick="inherit",
    volume={"up": "#4ADE80", "down": "#F87171"},
)
_style = mpf.make_mpf_style(
    base_mpf_style="nightclouds",
    marketcolors=_mc,
    facecolor="#0F0F0F",
    figcolor="#0F0F0F",
)
fig, axes = mpf.plot(
    df, type="candle", style=_style, volume=True,
    addplot=addplots if addplots else None,
    returnfig=True, figsize=(13, 7), tight_layout=True,
    title=f"\n{SYMBOL}  ·  {DAYS}d",
)
ax = axes[0]

# Horizontal lines with right-edge labels
for hl in ANNOTATIONS.get("hlines", []):
    ax.axhline(y=hl["price"], color=hl["color"], linestyle=hl.get("ls","--"), linewidth=1, alpha=0.85)
    ax.text(df.index[-1], hl["price"], f"  {hl['label']} {hl['price']:.1f}",
            color=hl["color"], fontsize=7.5, va="center", ha="left", clip_on=False,
            fontfamily="monospace")

# Vertical date lines
for vl in ANNOTATIONS.get("vlines", []):
    dt = pd.to_datetime(vl["date"])
    if dt in df.index or (df.index.min() <= dt <= df.index.max()):
        ax.axvline(x=dt, color=vl["color"], linestyle="--", linewidth=1, alpha=0.7)
        ylim = ax.get_ylim()
        ax.text(dt, ylim[1] * 0.995, f" {vl['label']}",
                color=vl["color"], fontsize=7, va="top", rotation=90,
                fontfamily="monospace")

# Free text labels
for lbl in ANNOTATIONS.get("labels", []):
    ax.text(pd.to_datetime(lbl["date"]), float(lbl["price"]), lbl["text"],
            color=lbl.get("color","#9A9A98"), fontsize=7.5, ha="center",
            fontfamily="monospace",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#1A1A1A", alpha=0.7, edgecolor="none"))

buf = io.BytesIO()
fig.savefig(buf, dpi=130, bbox_inches="tight", facecolor="#0F0F0F")
buf.seek(0)
print(base64.b64encode(buf.read()).decode(), end="")
```

---

### Step 4 — Execute

Run via the `terminal` tool:
```
python3 /tmp/ethos_chart_{symbol_clean}.py
```

The script installs its own dependencies on first run. Capture stdout (base64 string) and stderr separately. If exit code is non-zero, show the full stderr as a code block and stop.

---

### Step 5 — Return the chart

Reply with the inline image:
```
![{SYMBOL} · {DAYS}d](data:image/png;base64,{base64_output})
```

Then on a new line, a single sentence summarising what is marked on the chart, for example:
> Levels marked: Entry 2320 · Stop 2250 · T1 2600 · T2 2700 · Support 2180 · Resistance 2450

List only the levels that are actually present in `ANNOTATIONS.hlines`. If `hlines` is empty, omit the summary line entirely.

## Data Context

`{{nse_market_history}}` — OHLCV rows for the symbol over the requested period. Each row contains `date`, `open`, `high`, `low`, `close`, `volume`. Oldest row first.

`{{nse_market_indicators}}` — indicator rows for the same symbol and period. Each row contains `date` plus computed columns: `sma_20`, `sma_50`, `sma_200`, `ema_9`, `ema_21`, `psar`, `psar_bullish`, `rsi_14`, `macd_hist`, `atr_14`, `rvol`, `high_52w`, `low_52w`, `ath`, `sniper_score`, and others. Oldest row first.

`{{trade_setup}}` — optional. If a `trade_setup` skill result is available in the current context, its `entry_zone.low`, `stop_loss`, `target_1`, and `target_2` fields populate `hlines` automatically.

`{{stock_deep_analysis}}` — optional. If a `stock_deep_analysis` result is available, its support and resistance levels populate `hlines` automatically.
