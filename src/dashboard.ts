// ---------------------------------------------------------------------------
// dashboard.ts — Market dashboard data interfaces and HTML generation
// ---------------------------------------------------------------------------

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface IndexSummary {
  symbol: string;
  name: string;
  close: number | null;
  change_pct: number | null;
  stage: number | null;
}

export interface BreadthSnapshot {
  date: string;
  advances: number | null;
  declines: number | null;
  unchanged_count: number | null;
  ad_ratio: number | null;
  pct_above_50ma: number | null;
  pct_above_200ma: number | null;
  stage2_pct: number | null;
  ema_stack_bull_pct: number | null;
  mood_score: number | null;
  new_highs: number | null;
  new_lows: number | null;
}

export interface AdHistoryRow {
  date: string;
  advances: number | null;
  declines: number | null;
  ad_ratio: number | null;
}

export interface SectorRow {
  sector: string;
  return_1w: number | null;
  return_1m: number | null;
  return_3m: number | null;
  rs_rank: number | null;
  rs_rank_delta_1w: number | null;
  pct_members_stage2: number | null;
  top_stock_symbol: string | null;
}

export interface FiiDiiRow {
  date: string;
  fii_net: number | null;
  dii_net: number | null;
}

export interface TopStockRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  close: number | null;
  stage: number | null;
  composite_score: number | null;
  sniper_score: number | null;
  sniper_verdict: string | null;
  setup_type: string | null;
  rvol: number | null;
  rsi_14: number | null;
  return_1m: number | null;
  dist_52wk_high_pct: number | null;
  rs_rank_in_segment: number | null;
}

export interface StageDist {
  stage: number;
  count: number;
}

export interface CapRotation {
  large_rs_vs_broad: number | null;
  mid_rs_vs_broad: number | null;
  small_rs_vs_broad: number | null;
}

export interface DashboardData {
  as_of: string;
  indices: IndexSummary[];
  breadth: BreadthSnapshot | null;
  ad_history: AdHistoryRow[];
  sectors: SectorRow[];
  fii_dii: FiiDiiRow[];
  top_stocks: TopStockRow[];
  stage_dist: StageDist[];
  cap_rotation: CapRotation;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return Math.round(v).toLocaleString('en-IN');
}

function changeColor(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return 'var(--muted)';
  return v >= 0 ? 'var(--green)' : 'var(--red)';
}

function stageColor(stage: number | null | undefined): string {
  if (stage == null) return 'var(--muted)';
  switch (stage) {
    case 1:
      return 'var(--amber)';
    case 2:
      return 'var(--green)';
    case 3:
      return 'var(--orange)';
    case 4:
      return 'var(--red)';
    default:
      return 'var(--muted)';
  }
}

function stageLabel(stage: number): string {
  switch (stage) {
    case 1:
      return 'Base';
    case 2:
      return 'Uptrend';
    case 3:
      return 'Topping';
    case 4:
      return 'Decline';
    default:
      return `Stage ${stage}`;
  }
}

function setupLabel(id: string | null | undefined): string {
  if (!id) return '—';
  const map: Record<string, string> = {
    base_breakout: 'Base Breakout',
    momentum_surge: 'Momentum Surge',
    pullback_to_ema: 'Pullback to EMA',
    cup_with_handle: 'Cup & Handle',
    breakout_confirmed: 'Breakout',
  };
  if (map[id]) return map[id];
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function verdictClass(v: string | null | undefined): string {
  if (!v) return 'verdict-muted';
  const lc = v.toLowerCase().trim();
  if (lc === 'strong buy') return 'verdict-strong-buy';
  if (lc === 'buy') return 'verdict-buy';
  if (lc === 'hold' || lc === 'watch') return 'verdict-muted';
  return 'verdict-muted';
}

function placeholder(msg: string): string {
  return `<div class="placeholder"><span>${esc(msg)}</span></div>`;
}

// ── CSS ─────────────────────────────────────────────────────────────────────

function buildCss(): string {
  return `
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --border: #21262d;
  --text: #e6edf3;
  --muted: #8b949e;
  --blue: #58a6ff;
  --green: #3fb950;
  --red: #f85149;
  --amber: #e3b341;
  --orange: #d29922;
  --purple: #bc8cff;
  --teal: #39d353;
  --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  font-size:14px;line-height:1.5;
}

/* ── Dashboard Grid ────────────────────────────────────────────── */
.dashboard{
  padding:16px 20px;
  display:grid;
  grid-template-columns:260px 1fr 1fr;
  grid-template-rows:auto auto auto auto;
  gap:14px;
  max-width:1600px;margin:0 auto;
}

/* ── Panel Chrome ──────────────────────────────────────────────── */
.panel{
  background:var(--panel);border:1px solid var(--border);border-radius:8px;
  overflow:hidden;display:flex;flex-direction:column;
}
.panel-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:10px 14px;border-bottom:1px solid var(--border);
}
.panel-title{
  font-size:11px;font-weight:700;color:var(--muted);
  text-transform:uppercase;letter-spacing:.8px;
}
.panel-badge{
  font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;
  white-space:nowrap;
}
.panel-body{padding:14px;flex:1;min-height:0;display:flex;flex-direction:column}

/* ── Placeholder ───────────────────────────────────────────────── */
.placeholder{
  flex:1;display:flex;align-items:center;justify-content:center;
  color:#484f58;font-style:italic;text-align:center;padding:24px;
}

/* ── Market Health Panel ───────────────────────────────────────── */
.mood-score{
  text-align:center;padding:12px 0 8px;
}
.mood-score .value{
  font-size:52px;font-weight:700;font-family:var(--font-mono);line-height:1;
}
.mood-score .label{
  font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;
  margin-top:4px;
}
.health-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.health-stat{
  background:var(--bg);border:1px solid var(--border);border-radius:6px;
  padding:8px 10px;text-align:center;
}
.health-stat .stat-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.health-stat .stat-value{font-size:18px;font-weight:700;font-family:var(--font-mono)}
.nh-nl-row{display:flex;gap:10px;margin:10px 0;justify-content:center}
.nh-nl-item{
  display:flex;flex-direction:column;align-items:center;
  background:var(--bg);border:1px solid var(--border);border-radius:6px;
  padding:6px 14px;flex:1;
}
.nh-nl-item .nh-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.nh-nl-item .nh-value{font-size:20px;font-weight:700;font-family:var(--font-mono)}
.breadth-bars{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.breadth-bar-row{display:flex;align-items:center;gap:8px}
.breadth-bar-label{font-size:10px;color:var(--muted);width:90px;flex-shrink:0;text-align:right;white-space:nowrap}
.breadth-bar-track{flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.breadth-bar-fill{height:100%;border-radius:3px}
.breadth-bar-pct{font-size:10px;font-family:var(--font-mono);width:44px;flex-shrink:0;text-align:right}
.cap-section-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 6px;text-align:center}
.cap-bars{display:flex;flex-direction:column;gap:8px}
.cap-bar-row{display:flex;align-items:center;gap:8px}
.cap-bar-label{font-size:10px;color:var(--muted);width:50px;flex-shrink:0;text-align:right}
.cap-bar-track{flex:1;height:6px;background:var(--border);border-radius:3px;position:relative;overflow:hidden}
.cap-bar-center{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#484f58}
.cap-bar-fill{position:absolute;top:0;height:100%;border-radius:3px}
.cap-bar-val{font-size:10px;font-family:var(--font-mono);width:50px;flex-shrink:0}

/* ── Chart Panels ──────────────────────────────────────────────── */
.chart-wrap{flex:1;min-height:200px;position:relative}
.chart-wrap canvas{width:100%!important;height:100%!important}

/* ── FII/DII summary ──────────────────────────────────────────── */
.flow-summary{
  font-size:11px;color:var(--muted);padding:0 0 10px;text-align:center;
  font-family:var(--font-mono);
}

/* ── Stage Distribution ────────────────────────────────────────── */
.stage-dist-layout{display:flex;gap:16px;align-items:flex-start;flex:1;min-height:0}
.stage-donut-wrap{width:160px;flex-shrink:0;position:relative}
.stage-donut-wrap canvas{width:100%!important;height:160px!important}
.stage-legend-col{flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center}
.stage-legend-row{display:flex;flex-direction:column;gap:3px}
.stage-legend-top{display:flex;align-items:center;gap:6px;font-size:12px}
.stage-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.stage-legend-name{flex:1;color:var(--text)}
.stage-legend-pct{font-family:var(--font-mono);font-size:11px;color:var(--muted)}
.stage-legend-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden}
.stage-legend-bar-fill{height:100%;border-radius:2px}
.stage-footer{font-size:10px;color:var(--muted);text-align:center;padding-top:8px;margin-top:auto}

/* ── Top Stocks Table ──────────────────────────────────────────── */
.table-wrap{overflow-x:auto;flex:1}
table{width:100%;border-collapse:collapse;font-size:12px}
thead{position:sticky;top:0;z-index:1}
th{
  background:var(--bg);color:var(--muted);font-weight:600;text-align:left;
  padding:8px 10px;border-bottom:1px solid var(--border);
  white-space:nowrap;font-size:10px;text-transform:uppercase;letter-spacing:.5px;
}
td{padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
tr.stage2{background:rgba(63,185,80,0.03)}
tr.stage2:hover td{background:rgba(63,185,80,0.07)}
tr:hover td{background:#1c2128}
.col-rank{width:32px;text-align:center;color:var(--muted);font-size:11px}
.col-symbol{font-family:var(--font-mono);font-weight:600;color:var(--blue)}
.col-name{color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.col-sector{color:var(--muted);font-size:11px}
.col-num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--font-mono)}
.stage-pill{
  display:inline-block;padding:1px 7px;border-radius:10px;
  font-size:10px;font-weight:700;border:1px solid;
  background:transparent;
}
.verdict-pill{
  display:inline-block;padding:2px 8px;border-radius:10px;
  font-size:10px;font-weight:600;color:#fff;white-space:nowrap;
}
.verdict-strong-buy{background:var(--green)}
.verdict-buy{background:var(--blue)}
.verdict-muted{background:var(--border);color:var(--muted)}
.setup-pill{
  display:inline-block;padding:2px 8px;border-radius:10px;
  font-size:10px;font-weight:600;
  background:rgba(88,166,255,0.15);color:var(--blue);
  white-space:nowrap;
}
.rvol-hot{color:var(--green);font-weight:700}
.span-3{grid-column:span 3}

/* ── Responsive ────────────────────────────────────────────────── */
@media (max-width:1100px){
  .dashboard{grid-template-columns:240px 1fr}
}
@media (max-width:768px){
  .dashboard{grid-template-columns:1fr;padding:10px}
  .span-2,.span-3{grid-column:span 1}
  .stage-dist-layout{flex-direction:column}
  .stage-donut-wrap{width:100%}
}
`;
}

// ── Panel builders ──────────────────────────────────────────────────────────

function buildMarketHealthPanel(data: DashboardData): string {
  const b = data.breadth;
  const cap = data.cap_rotation;

  const headerHtml = `<div class="panel-header">
    <span class="panel-title">Market Health</span>
    <span class="panel-badge" style="background:rgba(88,166,255,0.15);color:var(--blue)">Breadth</span>
  </div>`;

  if (!b) {
    return `<div class="panel" style="grid-row:span 2">
      ${headerHtml}
      <div class="panel-body">${placeholder('No breadth data available')}</div>
    </div>`;
  }

  const moodColor =
    b.mood_score != null
      ? b.mood_score >= 60
        ? 'var(--green)'
        : b.mood_score >= 40
          ? 'var(--amber)'
          : 'var(--red)'
      : 'var(--muted)';

  const adRatioColor =
    b.ad_ratio != null
      ? b.ad_ratio >= 1.0
        ? 'var(--green)'
        : 'var(--red)'
      : 'var(--muted)';

  const breadthBar = (
    label: string,
    value: number | null,
    color: string,
  ): string => {
    const pct = value != null ? Math.max(0, Math.min(100, value)) : 0;
    return `<div class="breadth-bar-row">
      <span class="breadth-bar-label">${esc(label)}</span>
      <div class="breadth-bar-track">
        <div class="breadth-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
      </div>
      <span class="breadth-bar-pct" style="color:${color}">${value != null ? value.toFixed(1) + '%' : '—'}</span>
    </div>`;
  };

  const capBar = (label: string, value: number | null): string => {
    const pct = value != null ? Math.max(-100, Math.min(100, value)) : 0;
    const width = Math.abs(pct) / 2;
    const left = pct >= 0 ? 50 : 50 - width;
    const color = pct >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div class="cap-bar-row">
      <span class="cap-bar-label">${esc(label)}</span>
      <div class="cap-bar-track">
        <div class="cap-bar-center"></div>
        <div class="cap-bar-fill" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:${color}"></div>
      </div>
      <span class="cap-bar-val" style="color:${color}">${fmtPct(value, 1)}</span>
    </div>`;
  };

  return `<div class="panel" style="grid-row:span 2">
    ${headerHtml}
    <div class="panel-body">
      <div class="mood-score">
        <div class="value" style="color:${moodColor}">${b.mood_score != null ? Math.round(b.mood_score) : '—'}</div>
        <div class="label">MARKET MOOD SCORE &middot; /100</div>
      </div>
      <div class="health-grid">
        <div class="health-stat">
          <div class="stat-label">Advances</div>
          <div class="stat-value" style="color:var(--green)">${fmtInt(b.advances)}</div>
        </div>
        <div class="health-stat">
          <div class="stat-label">Declines</div>
          <div class="stat-value" style="color:var(--red)">${fmtInt(b.declines)}</div>
        </div>
        <div class="health-stat">
          <div class="stat-label">A/D Ratio</div>
          <div class="stat-value" style="color:${adRatioColor}">${fmtNum(b.ad_ratio)}</div>
        </div>
        <div class="health-stat">
          <div class="stat-label">Unchanged</div>
          <div class="stat-value" style="color:var(--muted)">${fmtInt(b.unchanged_count)}</div>
        </div>
      </div>
      <div class="nh-nl-row">
        <div class="nh-nl-item">
          <span class="nh-label">New Highs</span>
          <span class="nh-value" style="color:var(--green)">${fmtInt(b.new_highs)}</span>
        </div>
        <div class="nh-nl-item">
          <span class="nh-label">New Lows</span>
          <span class="nh-value" style="color:var(--red)">${fmtInt(b.new_lows)}</span>
        </div>
      </div>
      <div class="breadth-bars">
        ${breadthBar('% Above 50-MA', b.pct_above_50ma, 'var(--green)')}
        ${breadthBar('% Above 200-MA', b.pct_above_200ma, 'var(--teal)')}
        ${breadthBar('Stage 2 Stocks', b.stage2_pct, 'var(--blue)')}
        ${breadthBar('EMA Stack Bull', b.ema_stack_bull_pct, 'var(--purple)')}
      </div>
      <div class="cap-section-label">Cap Rotation (RS vs Broad)</div>
      <div class="cap-bars">
        ${capBar('Large', cap.large_rs_vs_broad)}
        ${capBar('Mid', cap.mid_rs_vs_broad)}
        ${capBar('Small', cap.small_rs_vs_broad)}
      </div>
    </div>
  </div>`;
}

function buildAdHistoryPanel(data: DashboardData): string {
  const latestRatio =
    data.ad_history.length > 0
      ? data.ad_history[data.ad_history.length - 1].ad_ratio
      : null;
  const badgeColor =
    latestRatio != null && latestRatio >= 1.0 ? 'var(--green)' : 'var(--red)';
  const badgeText =
    latestRatio != null ? `A/D ${latestRatio.toFixed(2)}` : 'A/D';

  const headerHtml = `<div class="panel-header">
    <span class="panel-title">Advance / Decline</span>
    <span class="panel-badge" style="background:color-mix(in srgb, ${badgeColor} 15%, transparent);color:${badgeColor}">${esc(badgeText)}</span>
  </div>`;

  if (data.ad_history.length === 0) {
    return `<div class="panel">
      ${headerHtml}
      <div class="panel-body">${placeholder('No A/D history available')}</div>
    </div>`;
  }

  return `<div class="panel">
    ${headerHtml}
    <div class="panel-body"><div class="chart-wrap"><canvas id="adChart"></canvas></div></div>
  </div>`;
}

function buildSectorPanel(data: DashboardData): string {
  const badgeText = `${data.sectors.length} sectors`;
  const headerHtml = `<div class="panel-header">
    <span class="panel-title">Sector Rotation</span>
    <span class="panel-badge" style="background:rgba(88,166,255,0.15);color:var(--blue)">${esc(badgeText)}</span>
  </div>`;

  if (data.sectors.length === 0) {
    return `<div class="panel">
      ${headerHtml}
      <div class="panel-body">${placeholder('No sector data available')}</div>
    </div>`;
  }

  return `<div class="panel">
    ${headerHtml}
    <div class="panel-body"><div class="chart-wrap"><canvas id="sectorChart"></canvas></div></div>
  </div>`;
}

function buildFiiDiiPanel(data: DashboardData): string {
  const headerHtml = `<div class="panel-header">
    <span class="panel-title">FII / DII Flows</span>
    <span class="panel-badge" style="background:rgba(188,140,255,0.15);color:var(--purple)">${data.fii_dii.length} days</span>
  </div>`;

  if (data.fii_dii.length === 0) {
    return `<div class="panel">
      ${headerHtml}
      <div class="panel-body">${placeholder('No flows data available')}</div>
    </div>`;
  }

  let fiiCum = 0;
  let diiCum = 0;
  for (const row of data.fii_dii) {
    fiiCum += row.fii_net ?? 0;
    diiCum += row.dii_net ?? 0;
  }
  const fmtCr = (v: number) =>
    `${v >= 0 ? '+' : ''}${Math.round(v).toLocaleString('en-IN')}`;
  const summaryHtml = `<div class="flow-summary">FII Net ₹${fmtCr(fiiCum)} Cr &nbsp;|&nbsp; DII Net ₹${fmtCr(diiCum)} Cr &nbsp;|&nbsp; ${data.fii_dii.length}-day cumulative</div>`;

  return `<div class="panel">
    ${headerHtml}
    <div class="panel-body">
      ${summaryHtml}
      <div class="chart-wrap"><canvas id="fiiDiiChart"></canvas></div>
    </div>
  </div>`;
}

function buildStageDistPanel(data: DashboardData): string {
  const s2 = data.stage_dist.find((d) => d.stage === 2);
  const total = data.stage_dist.reduce((s, r) => s + r.count, 0);
  const s2Pct = s2 && total > 0 ? ((s2.count / total) * 100).toFixed(1) : '0';
  const badgeText = `Stage 2 ↑ ${s2Pct}%`;

  const headerHtml = `<div class="panel-header">
    <span class="panel-title">Stage Distribution</span>
    <span class="panel-badge" style="background:rgba(63,185,80,0.15);color:var(--green)">${esc(badgeText)}</span>
  </div>`;

  if (data.stage_dist.length === 0) {
    return `<div class="panel">
      ${headerHtml}
      <div class="panel-body">${placeholder('No stage data available')}</div>
    </div>`;
  }

  const stageColors: Record<number, string> = {
    1: 'var(--amber)',
    2: 'var(--green)',
    3: 'var(--orange)',
    4: 'var(--red)',
  };

  const legendRows = data.stage_dist
    .map((r) => {
      const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : '0.0';
      const c = stageColors[r.stage] ?? 'var(--muted)';
      return `<div class="stage-legend-row">
        <div class="stage-legend-top">
          <span class="stage-legend-dot" style="background:${c}"></span>
          <span class="stage-legend-name">Stage ${r.stage} — ${esc(stageLabel(r.stage))}</span>
          <span class="stage-legend-pct">${pct}%</span>
        </div>
        <div class="stage-legend-bar">
          <div class="stage-legend-bar-fill" style="width:${pct}%;background:${c}"></div>
        </div>
      </div>`;
    })
    .join('');

  const dateStr = data.as_of
    ? new Date(data.as_of).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : data.as_of;

  return `<div class="panel">
    ${headerHtml}
    <div class="panel-body">
      <div class="stage-dist-layout">
        <div class="stage-donut-wrap"><canvas id="stageChart"></canvas></div>
        <div class="stage-legend-col">${legendRows}</div>
      </div>
      <div class="stage-footer">${total} active equities &middot; ${esc(dateStr)}</div>
    </div>
  </div>`;
}

function buildTopStocksPanel(data: DashboardData): string {
  const badgeText = `${data.top_stocks.length} setups`;
  const headerHtml = `<div class="panel-header">
    <span class="panel-title">Top Momentum Stocks</span>
    <span class="panel-badge" style="background:rgba(63,185,80,0.15);color:var(--green)">${esc(badgeText)}</span>
  </div>`;

  if (data.top_stocks.length === 0) {
    return `<div class="panel span-3">
      ${headerHtml}
      <div class="panel-body">${placeholder('No Stage 2 equities found')}</div>
    </div>`;
  }

  const headers = `<tr>
    <th>#</th><th>Symbol</th><th>Name</th><th>Sector</th><th>Stage</th>
    <th>Score</th><th>Sniper</th><th>Setup</th><th>RVOL</th><th>RSI</th>
    <th>1M Ret%</th><th>Dist 52wH%</th><th style="text-align:right">RS Rank</th>
  </tr>`;

  const rows = data.top_stocks
    .map((s, i) => {
      const sym = s.symbol.replace(/\.NS$/i, '');
      const stColor = stageColor(s.stage);
      const scoreColor =
        s.composite_score != null && s.composite_score >= 70
          ? 'var(--green)'
          : 'var(--text)';
      const scoreWeight =
        s.composite_score != null && s.composite_score >= 70 ? '700' : '400';
      const rvolHot = s.rvol != null && s.rvol >= 2.0;
      const rsiColor =
        s.rsi_14 != null
          ? s.rsi_14 > 60
            ? 'var(--green)'
            : s.rsi_14 < 40
              ? 'var(--red)'
              : 'var(--text)'
          : 'var(--muted)';
      const retColor = changeColor(s.return_1m);
      const retWeight = s.return_1m != null ? '700' : '400';
      const distColor =
        s.dist_52wk_high_pct != null
          ? s.dist_52wk_high_pct > -3
            ? 'var(--green)'
            : s.dist_52wk_high_pct > -8
              ? 'var(--text)'
              : 'var(--red)'
          : 'var(--muted)';

      return `<tr class="stage2">
        <td class="col-rank">${i + 1}</td>
        <td class="col-symbol">${esc(sym)}</td>
        <td class="col-name">${esc(s.name ?? '')}</td>
        <td class="col-sector">${esc(s.sector ?? '')}</td>
        <td><span class="stage-pill" style="color:${stColor};border-color:${stColor}">${s.stage != null ? 'S' + s.stage : '—'}</span></td>
        <td class="col-num" style="color:${scoreColor};font-weight:${scoreWeight}">${fmtNum(s.composite_score, 1)}</td>
        <td><span class="verdict-pill ${verdictClass(s.sniper_verdict)}">${esc(s.sniper_verdict ?? '—')}</span></td>
        <td><span class="setup-pill">${esc(setupLabel(s.setup_type))}</span></td>
        <td class="col-num${rvolHot ? ' rvol-hot' : ''}">${s.rvol != null ? s.rvol.toFixed(1) + 'x' : '—'}</td>
        <td class="col-num" style="color:${rsiColor}">${fmtNum(s.rsi_14, 1)}</td>
        <td class="col-num" style="color:${retColor};font-weight:${retWeight}">${fmtPct(s.return_1m, 1)}</td>
        <td class="col-num" style="color:${distColor}">${fmtPct(s.dist_52wk_high_pct, 1)}</td>
        <td class="col-num" style="text-align:right">${s.rs_rank_in_segment != null ? s.rs_rank_in_segment : '—'}</td>
      </tr>`;
    })
    .join('');

  return `<div class="panel span-3">
    ${headerHtml}
    <div class="panel-body">
      <div class="table-wrap">
        <table id="stocksTable">
          <thead>${headers}</thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── Client-side JS ──────────────────────────────────────────────────────────

function buildClientJs(): string {
  return `
(function() {
  Chart.defaults.color = '#8b949e';
  Chart.defaults.borderColor = '#21262d';
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  Chart.defaults.font.size = 11;

  var D = window.DASHBOARD_DATA;
  if (!D) return;

  var STAGE_COLORS = {1:'#e3b341',2:'#3fb950',3:'#d29922',4:'#f85149'};

  // ── A/D Chart: stacked bar + line ──────────────────────────────
  (function() {
    var el = document.getElementById('adChart');
    if (!el || !D.ad_history || D.ad_history.length === 0) return;

    var labels = D.ad_history.map(function(r){ return r.date; });
    var advs   = D.ad_history.map(function(r){ return r.advances; });
    var decs   = D.ad_history.map(function(r){ return r.declines != null ? -r.declines : null; });
    var ratio  = D.ad_history.map(function(r){ return r.ad_ratio; });

    new Chart(el, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Advances',
            data: advs,
            backgroundColor: 'rgba(63,185,80,0.7)',
            stack: 'ad',
            yAxisID: 'y',
            order: 2
          },
          {
            label: 'Declines',
            data: decs,
            backgroundColor: 'rgba(248,81,73,0.7)',
            stack: 'ad',
            yAxisID: 'y',
            order: 2
          },
          {
            label: 'A/D Ratio',
            data: ratio,
            type: 'line',
            borderColor: '#58a6ff',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#58a6ff',
            tension: 0.3,
            yAxisID: 'y2',
            order: 1
          }
        ]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { font: { size: 10 } },
            grid: { color: '#21262d' }
          },
          y: {
            stacked: true,
            ticks: {
              font: { size: 10 },
              callback: function(v) { return Math.abs(v); }
            },
            grid: { color: '#21262d' }
          },
          y2: {
            position: 'right',
            min: 0,
            max: 3,
            ticks: { color: '#58a6ff', font: { size: 10 } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  })();

  // ── Sector Rotation horizontal bar ────────────────────────────
  (function() {
    var el = document.getElementById('sectorChart');
    if (!el || !D.sectors || D.sectors.length === 0) return;

    var sorted = D.sectors.slice().sort(function(a,b){
      return (a.return_1w || 0) - (b.return_1w || 0);
    });
    var labels = sorted.map(function(r){ return r.sector; });
    var vals   = sorted.map(function(r){ return r.return_1w; });
    var colors = vals.map(function(v){
      if (v == null) return '#8b949e';
      if (v >= 2.5) return '#3fb950';
      if (v >= 1) return 'rgba(63,185,80,0.6)';
      if (v >= 0) return 'rgba(88,166,255,0.6)';
      if (v >= -1) return 'rgba(248,81,73,0.6)';
      return '#f85149';
    });

    new Chart(el, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '1W Return %',
          data: vals,
          backgroundColor: colors,
          borderRadius: 3
        }]
      },
      options: {
        indexAxis: 'y',
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var v = ctx.parsed.x;
                return v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '\\u2014';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { font: { size: 10 }, callback: function(v){ return v + '%'; } },
            grid: { color: '#21262d' }
          },
          y: {
            ticks: { font: { size: 11 } },
            grid: { display: false }
          }
        }
      }
    });
  })();

  // ── FII / DII Flows grouped bar ───────────────────────────────
  (function() {
    var el = document.getElementById('fiiDiiChart');
    if (!el || !D.fii_dii || D.fii_dii.length === 0) return;

    var labels = D.fii_dii.map(function(r){ return r.date; });
    var fii = D.fii_dii.map(function(r){ return r.fii_net; });
    var dii = D.fii_dii.map(function(r){ return r.dii_net; });

    var fiiColors = fii.map(function(v){
      return v != null && v >= 0 ? 'rgba(88,166,255,0.7)' : 'rgba(88,166,255,0.35)';
    });
    var diiColors = dii.map(function(v){
      return v != null && v >= 0 ? 'rgba(227,179,65,0.7)' : 'rgba(227,179,65,0.35)';
    });

    new Chart(el, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'FII Net', data: fii, backgroundColor: fiiColors, borderRadius: 2 },
          { label: 'DII Net', data: dii, backgroundColor: diiColors, borderRadius: 2 }
        ]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var v = ctx.parsed.y;
                if (v == null) return ctx.dataset.label + ': \\u2014';
                var sign = v >= 0 ? '+' : '';
                return ctx.dataset.label + ': \\u20b9' + sign + Math.round(v).toLocaleString('en-IN') + ' Cr';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { font: { size: 10 } },
            grid: { color: '#21262d' }
          },
          y: {
            ticks: {
              font: { size: 10 },
              callback: function(v) {
                if (typeof v !== 'number') return v;
                var sign = v >= 0 ? '+' : '';
                return '\\u20b9' + sign + v;
              }
            },
            grid: { color: '#21262d' }
          }
        }
      }
    });
  })();

  // ── Stage Distribution donut ──────────────────────────────────
  (function() {
    var el = document.getElementById('stageChart');
    if (!el || !D.stage_dist || D.stage_dist.length === 0) return;

    var values = D.stage_dist.map(function(r){ return r.count; });
    var colors = D.stage_dist.map(function(r){
      var c = STAGE_COLORS[r.stage] || '#8b949e';
      return c.replace(')', ',0.75)').replace('rgb(', 'rgba(').replace('#', '');
    });

    // Convert hex to rgba with 0.75 opacity
    var bgColors = D.stage_dist.map(function(r){
      var hex = STAGE_COLORS[r.stage] || '#8b949e';
      var rr = parseInt(hex.slice(1,3), 16);
      var gg = parseInt(hex.slice(3,5), 16);
      var bb = parseInt(hex.slice(5,7), 16);
      return 'rgba(' + rr + ',' + gg + ',' + bb + ',0.75)';
    });

    new Chart(el, {
      type: 'doughnut',
      data: {
        labels: D.stage_dist.map(function(r){ return 'Stage ' + r.stage; }),
        datasets: [{
          data: values,
          backgroundColor: bgColors,
          borderColor: '#0d1117',
          borderWidth: 2
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var total = values.reduce(function(a,b){ return a+b; }, 0);
                var pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : '0.0';
                return ctx.label + ': ' + ctx.parsed + ' (' + pct + '%)';
              }
            }
          }
        }
      }
    });
  })();
})();
`;
}

// ── Main export ─────────────────────────────────────────────────────────────

export function generateDashboardHtml(data: DashboardData): string {
  const safeData: DashboardData = {
    as_of: data.as_of ?? '',
    indices: Array.isArray(data.indices) ? data.indices : [],
    breadth: data.breadth ?? null,
    ad_history: Array.isArray(data.ad_history) ? data.ad_history : [],
    sectors: Array.isArray(data.sectors) ? data.sectors : [],
    fii_dii: Array.isArray(data.fii_dii) ? data.fii_dii : [],
    top_stocks: Array.isArray(data.top_stocks) ? data.top_stocks : [],
    stage_dist: Array.isArray(data.stage_dist) ? data.stage_dist : [],
    cap_rotation: data.cap_rotation ?? {
      large_rs_vs_broad: null,
      mid_rs_vs_broad: null,
      small_rs_vs_broad: null,
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NSE Market Dashboard — Swing Trader View</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js" crossorigin="anonymous"><\/script>
<style>${buildCss()}</style>
</head>
<body>
<div class="dashboard">
  ${buildMarketHealthPanel(safeData)}
  ${buildAdHistoryPanel(safeData)}
  ${buildSectorPanel(safeData)}
  ${buildFiiDiiPanel(safeData)}
  ${buildStageDistPanel(safeData)}
  ${buildTopStocksPanel(safeData)}
</div>
<script>var DASHBOARD_DATA = ${JSON.stringify(safeData)};window.DASHBOARD_DATA = DASHBOARD_DATA;<\/script>
<script>${buildClientJs()}<\/script>
</body>
</html>`;
}
