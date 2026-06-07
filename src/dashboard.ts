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
  if (v == null || Number.isNaN(v)) return '#8b949e';
  return v >= 0 ? '#3fb950' : '#f85149';
}

function stageColor(stage: number | null | undefined): string {
  if (stage == null) return '#8b949e';
  switch (stage) {
    case 1: return '#d29922';
    case 2: return '#3fb950';
    case 3: return '#f0883e';
    case 4: return '#f85149';
    default: return '#8b949e';
  }
}

function verdictColor(verdict: string | null | undefined): string {
  if (!verdict) return '#8b949e';
  const v = verdict.toLowerCase().trim();
  if (v === 'strong buy') return '#56d364';
  if (v === 'buy') return '#3fb950';
  if (v === 'watch') return '#d29922';
  if (v === 'avoid') return '#f0883e';
  if (v === 'sell') return '#f85149';
  return '#8b949e';
}

function placeholder(msg: string): string {
  return `<div class="placeholder"><span>${esc(msg)}</span></div>`;
}

// ── Panel builders ──────────────────────────────────────────────────────────

function buildMarketHealthPanel(data: DashboardData): string {
  if (!data.breadth) {
    return `<div class="panel" style="grid-column:1/4;grid-row:1/9">
      <h2>Market Health</h2>
      ${placeholder(`No breadth data for ${data.as_of}`)}
    </div>`;
  }

  const b = data.breadth;

  // Index 2x2 sub-grid
  const indexCards = data.indices
    .map(
      (ix) => `
      <div class="index-card">
        <div class="index-name">${esc(ix.name)}</div>
        <div class="index-close">${fmtNum(ix.close)}</div>
        <div class="index-change" style="color:${changeColor(ix.change_pct)}">${fmtPct(ix.change_pct)}</div>
      </div>`,
    )
    .join('');

  // Mini horizontal bar helper
  const miniBar = (label: string, value: number | null, color: string) => {
    const pct = value != null ? Math.max(0, Math.min(100, value)) : 0;
    return `
      <div class="mini-bar-row">
        <span class="mini-bar-label">${esc(label)}</span>
        <div class="mini-bar-track">
          <div class="mini-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="mini-bar-value">${fmtPct(value, 1)}</span>
      </div>`;
  };

  // Cap rotation bars
  const capBar = (label: string, value: number | null) => {
    const pct = value != null ? Math.max(-100, Math.min(100, value)) : 0;
    const offset = 50 + pct / 2;
    const width = Math.abs(pct) / 2;
    const left = pct >= 0 ? 50 : offset;
    return `
      <div class="mini-bar-row">
        <span class="mini-bar-label">${esc(label)}</span>
        <div class="mini-bar-track" style="position:relative">
          <div class="cap-center-line"></div>
          <div class="mini-bar-fill" style="position:absolute;left:${left}%;width:${width}%;background:${pct >= 0 ? '#3fb950' : '#f85149'}"></div>
        </div>
        <span class="mini-bar-value">${fmtPct(value, 1)}</span>
      </div>`;
  };

  return `<div class="panel" style="grid-column:1/4;grid-row:1/9">
    <h2>Market Health</h2>
    <div class="index-grid">${indexCards}</div>
    <div class="mood-block">
      <div class="mood-label">Mood Score</div>
      <div class="mood-value" style="color:${changeColor(b.mood_score)}">${fmtNum(b.mood_score, 1)}</div>
    </div>
    <div class="ad-counts">
      <span class="adv-count" style="color:#3fb950">Adv ${fmtInt(b.advances)}</span>
      <span class="dec-count" style="color:#f85149">Dec ${fmtInt(b.declines)}</span>
      <span class="unch-count" style="color:#8b949e">Unch ${fmtInt(b.unchanged_count)}</span>
    </div>
    <div class="mini-bars">
      ${miniBar('% > 50 MA', b.pct_above_50ma, '#58a6ff')}
      ${miniBar('% > 200 MA', b.pct_above_200ma, '#58a6ff')}
      ${miniBar('Stage 2 %', b.stage2_pct, '#3fb950')}
      ${miniBar('EMA Bull %', b.ema_stack_bull_pct, '#3fb950')}
    </div>
    <h3 class="sub-heading">Cap Rotation (RS vs Broad)</h3>
    <div class="mini-bars">
      ${capBar('Large', data.cap_rotation.large_rs_vs_broad)}
      ${capBar('Mid', data.cap_rotation.mid_rs_vs_broad)}
      ${capBar('Small', data.cap_rotation.small_rs_vs_broad)}
    </div>
    <div class="nh-nl">
      <span style="color:#3fb950">New Highs: ${fmtInt(b.new_highs)}</span>
      <span style="color:#f85149">New Lows: ${fmtInt(b.new_lows)}</span>
    </div>
  </div>`;
}

function buildAdHistoryPanel(data: DashboardData): string {
  if (data.ad_history.length === 0) {
    return `<div class="panel" style="grid-column:4/9;grid-row:1/5">
      <h2>A/D 7-Day</h2>
      ${placeholder('No A/D history available')}
    </div>`;
  }

  return `<div class="panel" style="grid-column:4/9;grid-row:1/5">
    <h2>A/D 7-Day</h2>
    <div class="chart-wrap"><canvas id="adChart"></canvas></div>
  </div>`;
}

function buildSectorPanel(data: DashboardData): string {
  if (data.sectors.length === 0) {
    return `<div class="panel" style="grid-column:9/13;grid-row:1/9">
      <h2>Sector Rotation</h2>
      ${placeholder(`No sector data for ${data.as_of}`)}
    </div>`;
  }

  return `<div class="panel" style="grid-column:9/13;grid-row:1/9">
    <h2>Sector Rotation</h2>
    <div class="chart-wrap"><canvas id="sectorChart"></canvas></div>
  </div>`;
}

function buildFiiDiiPanel(data: DashboardData): string {
  if (data.fii_dii.length === 0) {
    return `<div class="panel" style="grid-column:4/9;grid-row:5/9">
      <h2>FII / DII Flows</h2>
      ${placeholder('No flows data available')}
    </div>`;
  }

  return `<div class="panel" style="grid-column:4/9;grid-row:5/9">
    <h2>FII / DII Flows</h2>
    <div class="chart-wrap"><canvas id="fiiDiiChart"></canvas></div>
  </div>`;
}

function buildStageDistPanel(data: DashboardData): string {
  if (data.stage_dist.length === 0) {
    return `<div class="panel" style="grid-column:1/7;grid-row:9/13">
      <h2>Stage Distribution</h2>
      ${placeholder(`No stage data for ${data.as_of}`)}
    </div>`;
  }

  return `<div class="panel" style="grid-column:1/7;grid-row:9/13">
    <h2>Stage Distribution</h2>
    <div class="chart-wrap"><canvas id="stageChart"></canvas></div>
  </div>`;
}

function buildTopStocksPanel(data: DashboardData): string {
  if (data.top_stocks.length === 0) {
    return `<div class="panel full-width" style="grid-column:1/13;grid-row:13/19">
      <h2>Top Momentum Stocks</h2>
      ${placeholder(`No Stage 2 equities found for ${data.as_of}`)}
    </div>`;
  }

  const headerCols = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'name', label: 'Name' },
    { key: 'sector', label: 'Sector' },
    { key: 'stage', label: 'Stage' },
    { key: 'composite_score', label: 'Composite' },
    { key: 'sniper_verdict', label: 'Verdict' },
    { key: 'setup_type', label: 'Setup' },
    { key: 'rvol', label: 'RVOL' },
    { key: 'rsi_14', label: 'RSI' },
    { key: 'return_1m', label: '1M Ret%' },
    { key: 'dist_52wk_high_pct', label: 'Dist 52W%' },
    { key: 'rs_rank_in_segment', label: 'RS Rank' },
  ];

  const headers = headerCols
    .map(
      (c) =>
        `<th data-col="${esc(c.key)}" class="sortable">${esc(c.label)} <span class="sort-arrow"></span></th>`,
    )
    .join('');

  const rows = data.top_stocks
    .map((s) => {
      const sColor = stageColor(s.stage);
      const vColor = verdictColor(s.sniper_verdict);
      return `<tr>
        <td class="mono">${esc(s.symbol)}</td>
        <td>${esc(s.name ?? '')}</td>
        <td>${esc(s.sector ?? '')}</td>
        <td><span class="badge" style="background:${sColor}">${s.stage != null ? s.stage : '—'}</span></td>
        <td class="num">${fmtNum(s.composite_score)}</td>
        <td><span class="badge" style="background:${vColor}">${esc(s.sniper_verdict ?? '—')}</span></td>
        <td>${esc(s.setup_type ?? '—')}</td>
        <td class="num">${fmtNum(s.rvol)}</td>
        <td class="num">${fmtNum(s.rsi_14)}</td>
        <td class="num" style="color:${changeColor(s.return_1m)}">${fmtPct(s.return_1m)}</td>
        <td class="num">${fmtPct(s.dist_52wk_high_pct)}</td>
        <td class="num">${s.rs_rank_in_segment != null ? s.rs_rank_in_segment : '—'}</td>
      </tr>`;
    })
    .join('');

  return `<div class="panel full-width" style="grid-column:1/13;grid-row:13/19">
    <h2>Top Momentum Stocks</h2>
    <div class="table-wrap">
      <table id="stocksTable">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

// ── CSS ─────────────────────────────────────────────────────────────────────

function buildCss(): string {
  return `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      background:#0d1117;color:#c9d1d9;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      font-size:14px;line-height:1.5;padding:24px;
    }
    h1{font-size:20px;font-weight:600;margin-bottom:16px;color:#e6edf3}
    h2{font-size:15px;font-weight:600;margin-bottom:12px;color:#e6edf3}
    h3.sub-heading{font-size:12px;font-weight:600;margin:12px 0 6px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}

    .dashboard{
      display:grid;
      grid-template-columns:repeat(12,1fr);
      grid-template-rows:repeat(18,minmax(40px,auto));
      gap:12px;
      max-width:1440px;margin:0 auto;
    }

    .panel{
      background:#161b22;border:1px solid #21262d;border-radius:8px;
      padding:16px;overflow:hidden;display:flex;flex-direction:column;
    }
    .chart-wrap{flex:1;min-height:0;position:relative}
    .chart-wrap canvas{width:100%!important;height:100%!important}

    /* Placeholder */
    .placeholder{
      flex:1;display:flex;align-items:center;justify-content:center;
      color:#484f58;font-style:italic;text-align:center;padding:24px;
    }

    /* Index 2x2 grid */
    .index-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
    .index-card{
      background:#0d1117;border:1px solid #21262d;border-radius:6px;
      padding:8px;text-align:center;
    }
    .index-name{font-size:11px;color:#8b949e;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .index-close{font-size:16px;font-weight:600;color:#e6edf3}
    .index-change{font-size:13px;font-weight:500}

    /* Mood block */
    .mood-block{text-align:center;margin:8px 0}
    .mood-label{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
    .mood-value{font-size:36px;font-weight:700}

    /* A/D counts */
    .ad-counts{display:flex;gap:12px;justify-content:center;margin-bottom:10px;font-size:13px;font-weight:500}

    /* Mini bars */
    .mini-bars{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
    .mini-bar-row{display:flex;align-items:center;gap:8px}
    .mini-bar-label{font-size:11px;color:#8b949e;width:80px;flex-shrink:0;text-align:right}
    .mini-bar-track{flex:1;height:8px;background:#21262d;border-radius:4px;overflow:hidden;position:relative}
    .mini-bar-fill{height:100%;border-radius:4px;transition:width .3s}
    .mini-bar-value{font-size:11px;color:#c9d1d9;width:56px;flex-shrink:0}
    .cap-center-line{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#484f58}

    .nh-nl{display:flex;gap:16px;justify-content:center;margin-top:8px;font-size:12px;font-weight:500}

    /* Table */
    .table-wrap{overflow-x:auto;flex:1}
    table{width:100%;border-collapse:collapse;font-size:13px}
    thead{position:sticky;top:0;z-index:1}
    th{
      background:#0d1117;color:#8b949e;font-weight:600;text-align:left;
      padding:8px 10px;border-bottom:1px solid #21262d;cursor:pointer;
      white-space:nowrap;user-select:none;
    }
    th:hover{color:#e6edf3}
    td{padding:6px 10px;border-bottom:1px solid #21262d;white-space:nowrap}
    tr:hover td{background:#1c2128}
    .mono{font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-weight:500}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    .badge{
      display:inline-block;padding:2px 8px;border-radius:12px;
      font-size:11px;font-weight:600;color:#fff;
    }
    .sort-arrow{font-size:10px;margin-left:2px}
    .sortable{position:relative}
    .sort-asc .sort-arrow::after{content:'\\25B2'}
    .sort-desc .sort-arrow::after{content:'\\25BC'}

    /* Stage dist legend (beside donut) */
    .stage-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:8px;justify-content:center}
    .stage-legend-item{display:flex;align-items:center;gap:4px;font-size:12px}
    .stage-legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  `;
}

// ── Client-side JS ──────────────────────────────────────────────────────────

function buildClientJs(): string {
  return `
    document.addEventListener('DOMContentLoaded', function() {
      var D = window.DASHBOARD_DATA;
      if (!D) return;

      var STAGE_COLORS = {1:'#d29922',2:'#3fb950',3:'#f0883e',4:'#f85149'};

      // ── A/D 7-Day stacked bar + line ──────────────────────────────────
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
                backgroundColor: '#3fb950',
                stack: 'ad',
                yAxisID: 'y',
                order: 2
              },
              {
                label: 'Declines',
                data: decs,
                backgroundColor: '#f85149',
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
                yAxisID: 'y1',
                order: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { labels: { color: '#8b949e', boxWidth: 12, font: { size: 11 } } }
            },
            scales: {
              x: {
                ticks: { color: '#8b949e', font: { size: 10 } },
                grid: { color: '#21262d' }
              },
              y: {
                stacked: true,
                ticks: { color: '#8b949e', font: { size: 10 } },
                grid: { color: '#21262d' }
              },
              y1: {
                position: 'right',
                ticks: { color: '#58a6ff', font: { size: 10 } },
                grid: { drawOnChartArea: false }
              }
            }
          }
        });
      })();

      // ── Sector Rotation horizontal bar ────────────────────────────────
      (function() {
        var el = document.getElementById('sectorChart');
        if (!el || !D.sectors || D.sectors.length === 0) return;

        var sorted = D.sectors.slice().sort(function(a,b){
          return (b.return_1w || 0) - (a.return_1w || 0);
        });
        var labels = sorted.map(function(r){ return r.sector; });
        var vals   = sorted.map(function(r){ return r.return_1w; });
        var colors = vals.map(function(v){ return v != null && v >= 0 ? '#3fb950' : '#f85149'; });

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
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var v = ctx.parsed.x;
                    return v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—';
                  }
                }
              }
            },
            scales: {
              x: {
                ticks: { color: '#8b949e', font: { size: 10 }, callback: function(v){ return v + '%'; } },
                grid: { color: '#21262d' }
              },
              y: {
                ticks: { color: '#c9d1d9', font: { size: 11 } },
                grid: { display: false }
              }
            }
          }
        });
      })();

      // ── FII / DII Flows grouped bar ───────────────────────────────────
      (function() {
        var el = document.getElementById('fiiDiiChart');
        if (!el || !D.fii_dii || D.fii_dii.length === 0) return;

        var labels = D.fii_dii.map(function(r){ return r.date; });
        var fii = D.fii_dii.map(function(r){ return r.fii_net; });
        var dii = D.fii_dii.map(function(r){ return r.dii_net; });

        new Chart(el, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              { label: 'FII Net', data: fii, backgroundColor: '#58a6ff', borderRadius: 2 },
              { label: 'DII Net', data: dii, backgroundColor: '#d29922', borderRadius: 2 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { labels: { color: '#8b949e', boxWidth: 12, font: { size: 11 } } },
              annotation: undefined
            },
            scales: {
              x: {
                ticks: { color: '#8b949e', font: { size: 10 } },
                grid: { color: '#21262d' }
              },
              y: {
                ticks: {
                  color: '#8b949e',
                  font: { size: 10 },
                  callback: function(v) {
                    if (typeof v !== 'number') return v;
                    if (Math.abs(v) >= 1e4) return (v / 1000).toFixed(0) + 'K';
                    return v;
                  }
                },
                grid: { color: '#21262d' }
              }
            }
          },
          plugins: [{
            id: 'zeroLine',
            afterDraw: function(chart) {
              var yScale = chart.scales.y;
              if (!yScale) return;
              var zero = yScale.getPixelForValue(0);
              var ctx = chart.ctx;
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(chart.chartArea.left, zero);
              ctx.lineTo(chart.chartArea.right, zero);
              ctx.lineWidth = 1;
              ctx.strokeStyle = '#484f58';
              ctx.stroke();
              ctx.restore();
            }
          }]
        });
      })();

      // ── Stage Distribution donut ──────────────────────────────────────
      (function() {
        var el = document.getElementById('stageChart');
        if (!el || !D.stage_dist || D.stage_dist.length === 0) return;

        var total = D.stage_dist.reduce(function(s,r){ return s + r.count; }, 0);
        var labels = D.stage_dist.map(function(r){ return 'Stage ' + r.stage; });
        var values = D.stage_dist.map(function(r){ return r.count; });
        var colors = D.stage_dist.map(function(r){ return STAGE_COLORS[r.stage] || '#8b949e'; });

        new Chart(el, {
          type: 'doughnut',
          data: {
            labels: labels,
            datasets: [{
              data: values,
              backgroundColor: colors,
              borderColor: '#161b22',
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : '0.0';
                    return ctx.label + ': ' + ctx.parsed + ' (' + pct + '%)';
                  }
                }
              }
            }
          }
        });

        // Build legend
        var legendEl = el.closest('.panel').querySelector('.stage-legend');
        if (legendEl) {
          legendEl.innerHTML = D.stage_dist.map(function(r) {
            var pct = total > 0 ? (r.count / total * 100).toFixed(1) : '0.0';
            var c = STAGE_COLORS[r.stage] || '#8b949e';
            return '<span class="stage-legend-item">'
              + '<span class="stage-legend-dot" style="background:' + c + '"></span>'
              + 'S' + r.stage + ': ' + r.count + ' (' + pct + '%)'
              + '</span>';
          }).join('');
        }
      })();

      // ── Table sorting ─────────────────────────────────────────────────
      (function() {
        var table = document.getElementById('stocksTable');
        if (!table) return;
        var thead = table.querySelector('thead');
        var tbody = table.querySelector('tbody');
        var ths = thead.querySelectorAll('th');
        var currentSort = { col: null, dir: 'asc' };

        ths.forEach(function(th, idx) {
          th.addEventListener('click', function() {
            var col = th.getAttribute('data-col');
            if (currentSort.col === col) {
              currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
              currentSort.col = col;
              currentSort.dir = 'asc';
            }

            ths.forEach(function(t){ t.classList.remove('sort-asc','sort-desc'); });
            th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');

            var rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort(function(a,b) {
              var aVal = a.children[idx].textContent.replace(/[,%+\\s]/g,'').trim();
              var bVal = b.children[idx].textContent.replace(/[,%+\\s]/g,'').trim();

              var aNum = parseFloat(aVal);
              var bNum = parseFloat(bVal);
              var aIsNum = !isNaN(aNum) && aVal !== '' && aVal !== '\\u2014';
              var bIsNum = !isNaN(bNum) && bVal !== '' && bVal !== '\\u2014';

              var cmp;
              if (aIsNum && bIsNum) {
                cmp = aNum - bNum;
              } else if (aIsNum) {
                cmp = -1;
              } else if (bIsNum) {
                cmp = 1;
              } else {
                cmp = aVal.localeCompare(bVal);
              }

              return currentSort.dir === 'asc' ? cmp : -cmp;
            });

            rows.forEach(function(r){ tbody.appendChild(r); });
          });
        });
      })();
    });
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

  const stageDistPanel = buildStageDistPanel(safeData);
  // Inject the legend container into the stage dist panel if it has a canvas
  const stageDistWithLegend = stageDistPanel.includes('stageChart')
    ? stageDistPanel.replace(
        '</div>\n  </div>',
        '</div>\n    <div class="stage-legend"></div>\n  </div>',
      )
    : stageDistPanel;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NSE Market Dashboard — ${esc(safeData.as_of)}</title>
<style>${buildCss()}</style>
</head>
<body>
<h1>NSE Market Dashboard &mdash; ${esc(safeData.as_of)}</h1>
<div class="dashboard">
  ${buildMarketHealthPanel(safeData)}
  ${buildAdHistoryPanel(safeData)}
  ${buildSectorPanel(safeData)}
  ${buildFiiDiiPanel(safeData)}
  ${stageDistWithLegend}
  ${buildTopStocksPanel(safeData)}
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"><\/script>
<script>
var DASHBOARD_DATA = ${JSON.stringify(safeData)};
window.DASHBOARD_DATA = DASHBOARD_DATA;
</script>
<script>${buildClientJs()}<\/script>
</body>
</html>`;
}
