import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { fetchOhlcv } from './fetcher';
import {
  aggregateToMonthly,
  aggregateToWeekly,
  computeAdr,
  computeAdx,
  computeAtr,
  computeBollingerBands,
  computeCci,
  computeClosePositionRatio,
  computeCompositeScore,
  computeDonchian,
  computeEma,
  computeEmaSlope,
  computeKeltnerChannels,
  computeMacd,
  computeMaStack,
  computeObv,
  computeObvSlope,
  computePsar,
  computeRoc,
  computeRsi,
  computeSetupType,
  computeSma,
  computeSniperScore,
  computeStage,
  computeStochastic,
  computeTfAlignmentScore,
  computeVwap,
  computeWilliamsR,
  detectCandlePatterns,
} from './indicators';
import type {
  BulkBlockDealDbRow,
  CorporateActionDbRow,
  FiiDiiDbRow,
  IndexConstituentSeedRow,
  InstrumentSeedRow,
  SavedScanRow,
} from './schema';
import { migrate } from './schema';

export interface OhlcvRow {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number | null;
}

export interface SyncResult {
  symbol: string;
  rowsInserted: number;
  fromDate: string;
  toDate: string;
}

export interface ScreenerRow {
  symbol: string;
  close: number;
  volume: number;
  high52w: number;
  low52w: number;
  pctFrom52wHigh: number;
  avgVolume20d: number;
  volumeSurge: number;
}

export interface WatchlistEntry {
  symbol: string;
  notes: string | null;
  addedAt: number;
}

export interface IndicatorRow {
  symbol: string;
  date: string;
  ema_20: number | null;
  ema_50: number | null;
  ema_100: number | null;
  ema_200: number | null;
  sma_50: number | null;
  sma_200: number | null;
  ma_stack: number | null;
  ema_50_slope: number | null;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  macd_hist_prev: number | null;
  adx: number | null;
  adx_di_plus: number | null;
  adx_di_minus: number | null;
  stoch_k: number | null;
  stoch_d: number | null;
  cci_20: number | null;
  williams_r: number | null;
  psar: number | null;
  psar_signal: number | null;
  psar_signal_prev: number | null;
  roc_5: number | null;
  return_1d: number | null;
  return_1w: number | null;
  return_1m: number | null;
  return_3m: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_ytd: number | null;
  rs_vs_segment: number | null;
  rs_vs_broad: number | null;
  rs_rank_in_segment: number | null;
  rs_rank_in_sector: number | null;
  atr_14: number | null;
  adr_pct: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  bb_middle: number | null;
  bb_width: number | null;
  keltner_upper: number | null;
  keltner_lower: number | null;
  donchian_upper_20: number | null;
  donchian_lower_20: number | null;
  rvol: number | null;
  vol_sma_20: number | null;
  avg_dollar_volume_20: number | null;
  delivery_pct: number | null;
  delivery_ma_20: number | null;
  obv: number | null;
  obv_slope_5d: number | null;
  close_position_ratio: number | null;
  vwap: number | null;
  closed_above_vwap: number | null;
  dist_52wk_high_pct: number | null;
  dist_52wk_low_pct: number | null;
  dist_ath_pct: number | null;
  pct_from_ema20: number | null;
  pct_from_ema50: number | null;
  pct_from_ema200: number | null;
  price_percentile_52w: number | null;
  candle_pattern: string | null;
  ema_20_weekly: number | null;
  ema_50_weekly: number | null;
  close_vs_ema20w: number | null;
  close_vs_ema50w: number | null;
  rsi_14_weekly: number | null;
  macd_hist_weekly: number | null;
  ema_10_monthly: number | null;
  close_vs_ema10m: number | null;
  tf_alignment_score: number | null;
  stage: number | null;
  sniper_score: number | null;
  sniper_verdict: string | null;
  composite_score: number | null;
  composite_grade: string | null;
  setup_type: string | null;
  setup_quality: number | null;
}

export interface MarketStateRow {
  date: string;
  nifty_close: number | null;
  nifty_vs_ema50: number | null;
  nifty_vs_ema200: number | null;
  nifty_ema50_slope: number | null;
  nifty_stage: number | null;
  nifty_sniper_score: number | null;
  advances: number | null;
  declines: number | null;
  unchanged_count: number | null;
  ad_ratio: number | null;
  pct_above_50ma: number | null;
  pct_above_200ma: number | null;
  new_highs: number | null;
  new_lows: number | null;
  up_volume: number | null;
  down_volume: number | null;
  pct_up_2: number | null;
  pct_down_2: number | null;
  pct_above_vwap: number | null;
  ema_stack_bull_pct: number | null;
  ema200_breadth_pct: number | null;
  ema50_breadth_pct: number | null;
  macd_breadth_pct: number | null;
  adx_trending_pct: number | null;
  avg_rsi: number | null;
  pct_oversold: number | null;
  pct_overbought: number | null;
  smart_money_acc_count: number | null;
  smart_money_dist_count: number | null;
  bull_divergence_count: number | null;
  bear_divergence_count: number | null;
  bb_squeeze_count: number | null;
  gap_ups_count: number | null;
  gap_downs_count: number | null;
  vol_surges_count: number | null;
  stage2_pct: number | null;
  stage4_pct: number | null;
  mood_score: number | null;
  india_vix: number | null;
}

export interface BacktestTrade {
  symbol: string;
  signal_date: string;
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  exit_reason: 'stop' | 'time';
  pnl_pct: number;
  holding_days: number;
  setup_type: string | null;
  sniper_score: number | null;
  regime_stage: number | null;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  summary: {
    total_trades: number;
    win_rate: number;
    avg_gain_wins: number;
    avg_loss: number;
    expectancy: number;
    max_drawdown: number;
    sharpe_approx: number;
    benchmark_return: number;
    screen_alpha: number;
    avg_hold: number;
  };
  by_regime: Record<string, { trades: number; win_rate: number; expectancy: number }>;
}

export interface WatchdogResult {
  matched: boolean;
  suppressed: boolean;
  current_values: {
    symbol: string;
    date: string;
    rvol: number | null;
    dist_52wk_high_pct: number | null;
    setup_type: string | null;
    sniper_score: number | null;
    stage: number | null;
    composite_score: number | null;
    rsi_14: number | null;
  } | null;
  last_alerted_date: string | null;
}

export interface SectorStateRow {
  date: string;
  sector: string;
  sector_index_symbol: string | null;
  sector_return_1d: number | null;
  sector_return_1w: number | null;
  sector_return_1m: number | null;
  sector_return_3m: number | null;
  sector_return_6m: number | null;
  sector_return_ytd: number | null;
  rs_rank: number | null;
  rs_rank_prev_week: number | null;
  rs_rank_delta_1w: number | null;
  pct_members_uptrend: number | null;
  pct_members_stage2: number | null;
  advances: number | null;
  declines: number | null;
  avg_member_rs: number | null;
  avg_member_composite: number | null;
  top_stock_symbol: string | null;
  top_stock_return_1d: number | null;
  breadth_pct: number | null;
}

function addOneDayToDate(date: string): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export class MarketDataStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  clean(): { rowsDeleted: { ohlcv: number; watchlist: number; syncMeta: number } } {
    const cleanTx = this.db.transaction(() => {
      const ohlcv = this.db.prepare('DELETE FROM ohlcv_daily').run().changes;
      const watchlist = this.db.prepare('DELETE FROM watchlist').run().changes;
      const syncMeta = this.db.prepare('DELETE FROM sync_meta').run().changes;
      return { ohlcv, watchlist, syncMeta };
    });
    const result = cleanTx() as { ohlcv: number; watchlist: number; syncMeta: number };
    return { rowsDeleted: result };
  }

  // ---------------------------------------------------------------------------
  // Network methods
  // ---------------------------------------------------------------------------

  async backfillSymbol(symbol: string, fromDate: string): Promise<SyncResult> {
    const toDate = new Date().toISOString().slice(0, 10);
    const rows = await fetchOhlcv(symbol, fromDate, toDate);
    this.insertOhlcv(rows);
    const lastDate = rows[rows.length - 1]?.date ?? toDate;
    this.db
      .prepare('INSERT OR REPLACE INTO sync_meta (symbol, last_sync, last_date) VALUES (?, ?, ?)')
      .run(symbol, Date.now(), lastDate);
    return { symbol, rowsInserted: rows.length, fromDate, toDate };
  }

  async backfillAll(
    symbols: string[],
    fromDate: string,
    onProgress?: (done: number, total: number, symbol: string) => void,
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    let done = 0;
    for (const symbol of symbols) {
      try {
        const result = await this.backfillSymbol(symbol, fromDate);
        results.push(result);
      } catch (err) {
        console.error(`backfillAll: failed for ${symbol}:`, err);
        results.push({
          symbol,
          rowsInserted: 0,
          fromDate,
          toDate: new Date().toISOString().slice(0, 10),
        });
      }
      done++;
      onProgress?.(done, symbols.length, symbol);
    }
    return results;
  }

  async updateSymbol(symbol: string): Promise<SyncResult> {
    const row = this.db.prepare('SELECT last_date FROM sync_meta WHERE symbol = ?').get(symbol) as
      | { last_date: string }
      | undefined;

    const lastDate =
      row?.last_date ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const fromDate = addOneDayToDate(lastDate);
    const today = new Date().toISOString().slice(0, 10);

    if (fromDate > today) {
      return { symbol, rowsInserted: 0, fromDate, toDate: today };
    }

    return this.backfillSymbol(symbol, fromDate);
  }

  async updateWatchlist(): Promise<SyncResult[]> {
    const rows = this.db.prepare('SELECT DISTINCT symbol FROM watchlist').all() as Array<{
      symbol: string;
    }>;
    const results: SyncResult[] = [];
    for (const row of rows) {
      try {
        results.push(await this.updateSymbol(row.symbol));
      } catch (err) {
        console.error(`updateWatchlist: failed for ${row.symbol}:`, err);
        results.push({
          symbol: row.symbol,
          rowsInserted: 0,
          fromDate: '',
          toDate: new Date().toISOString().slice(0, 10),
        });
      }
    }
    return results;
  }

  async updateAll(): Promise<SyncResult[]> {
    const rows = this.db.prepare('SELECT symbol FROM sync_meta').all() as Array<{ symbol: string }>;
    const results: SyncResult[] = [];
    for (const row of rows) {
      try {
        results.push(await this.updateSymbol(row.symbol));
      } catch (err) {
        console.error(`updateAll: failed for ${row.symbol}:`, err);
        results.push({
          symbol: row.symbol,
          rowsInserted: 0,
          fromDate: '',
          toDate: new Date().toISOString().slice(0, 10),
        });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Watchlist
  // ---------------------------------------------------------------------------

  watchlistAdd(symbol: string, listName = 'default', notes?: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO watchlist (symbol, list_name, notes, added_at) VALUES (?, ?, ?, ?)',
      )
      .run(symbol, listName, notes ?? null, Date.now());
  }

  watchlistRemove(symbol: string, listName = 'default'): void {
    this.db
      .prepare('DELETE FROM watchlist WHERE symbol = ? AND list_name = ?')
      .run(symbol, listName);
  }

  watchlistList(listName = 'default'): WatchlistEntry[] {
    const rows = this.db
      .prepare(
        'SELECT symbol, notes, added_at FROM watchlist WHERE list_name = ? ORDER BY added_at ASC',
      )
      .all(listName) as Array<{ symbol: string; notes: string | null; added_at: number }>;
    return rows.map((r) => ({ symbol: r.symbol, notes: r.notes, addedAt: r.added_at }));
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  getHistory(symbol: string, days = 252): OhlcvRow[] {
    const rows = this.db
      .prepare(
        `SELECT symbol, date, open, high, low, close, volume, adj_close
         FROM (
           SELECT symbol, date, open, high, low, close, volume, adj_close
           FROM ohlcv_daily
           WHERE symbol = ?
           ORDER BY date DESC
           LIMIT ?
         )
         ORDER BY date ASC`,
      )
      .all(symbol, days) as Array<{
      symbol: string;
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      adj_close: number | null;
    }>;
    return rows.map((r) => ({
      symbol: r.symbol,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      adjClose: r.adj_close,
    }));
  }

  // ---------------------------------------------------------------------------
  // Screener
  // ---------------------------------------------------------------------------

  screen(opts: {
    listName?: string;
    minVolumeSurge?: number;
    nearHighPct?: number;
  }): ScreenerRow[] {
    const listName = opts.listName ?? 'default';
    const symbols = this.watchlistList(listName).map((e) => e.symbol);
    if (symbols.length === 0) return [];

    const results: ScreenerRow[] = [];

    for (const symbol of symbols) {
      const rows = this.getHistory(symbol, 252);
      if (rows.length === 0) continue;

      const last = rows[rows.length - 1];
      if (!last) continue;

      const high52w = Math.max(...rows.map((r) => r.high));
      const low52w = Math.min(...rows.map((r) => r.low));
      const pctFrom52wHigh = high52w > 0 ? ((high52w - last.close) / high52w) * 100 : 0;

      const recent20 = rows.slice(-20);
      const avgVolume20d =
        recent20.length > 0
          ? recent20.reduce((sum, r) => sum + r.volume, 0) / recent20.length
          : last.volume;
      const volumeSurge = avgVolume20d > 0 ? last.volume / avgVolume20d : 1;

      if (opts.minVolumeSurge !== undefined && volumeSurge < opts.minVolumeSurge) continue;
      if (opts.nearHighPct !== undefined && pctFrom52wHigh > opts.nearHighPct) continue;

      results.push({
        symbol,
        close: last.close,
        volume: last.volume,
        high52w,
        low52w,
        pctFrom52wHigh,
        avgVolume20d,
        volumeSurge,
      });
    }

    return results.sort((a, b) => b.volumeSurge - a.volumeSurge);
  }

  // ---------------------------------------------------------------------------
  // Raw insert — used by fetcher (Phase 2) and tests
  // ---------------------------------------------------------------------------

  insertOhlcv(rows: OhlcvRow[]): number {
    if (rows.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ohlcv_daily (symbol, date, open, high, low, close, volume, adj_close, adj_factor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMany = this.db.transaction((items: OhlcvRow[]) => {
      for (const r of items) {
        stmt.run(
          r.symbol,
          r.date,
          r.open,
          r.high,
          r.low,
          r.close,
          Math.round(r.volume),
          r.adjClose ?? null,
          r.adjClose !== null && r.close > 0 ? r.adjClose / r.close : null,
        );
      }
    });
    insertMany(rows);
    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // Phase 1 seed methods
  // ---------------------------------------------------------------------------

  upsertInstruments(rows: InstrumentSeedRow[]): { upserted: number; removed: number } {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO instruments
         (symbol, name, exchange, sector, isin, added_at,
          industry, market_cap_band, instrument_type, index_category, is_active, as_of_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const upsertTx = this.db.transaction((items: InstrumentSeedRow[]) => {
      for (const r of items) {
        stmt.run(
          r.symbol,
          r.name,
          r.exchange ?? 'NSE',
          r.sector ?? null,
          r.isin ?? null,
          Date.now(),
          r.industry ?? null,
          r.market_cap_band ?? null,
          r.instrument_type ?? 'equity',
          r.index_category ?? null,
          r.is_active ?? 1,
          r.as_of_date ?? null,
        );
      }
    });
    upsertTx(rows);

    const symbols = rows.map((r) => r.symbol);
    let removed = 0;
    if (symbols.length > 0) {
      const placeholders = symbols.map(() => '?').join(', ');
      const result = this.db
        .prepare(`DELETE FROM instruments WHERE symbol NOT IN (${placeholders})`)
        .run(...symbols);
      removed = result.changes;
    }

    return { upserted: rows.length, removed };
  }

  upsertIndexConstituents(rows: IndexConstituentSeedRow[]): number {
    if (rows.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO index_constituents
         (index_symbol, member_symbol, weight, as_of_date)
       VALUES (?, ?, ?, ?)`,
    );
    const upsertTx = this.db.transaction((items: IndexConstituentSeedRow[]) => {
      for (const r of items) {
        stmt.run(r.index_symbol, r.member_symbol, r.weight ?? null, r.as_of_date);
      }
    });
    upsertTx(rows);
    return rows.length;
  }

  upsertScans(scans: SavedScanRow[]): { upserted: number } {
    if (scans.length === 0) return { upserted: 0 };
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO saved_scans
         (scan_id, name, category, description, sql_template, tags, is_builtin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const upsertTx = this.db.transaction((items: SavedScanRow[]) => {
      for (const s of items) {
        stmt.run(
          s.scan_id,
          s.name,
          s.category,
          s.description ?? null,
          s.sql_template,
          s.tags != null ? JSON.stringify(s.tags) : null,
          s.is_builtin ?? 1,
        );
      }
    });
    upsertTx(scans);
    return { upserted: scans.length };
  }

  listInstrumentSymbols(): string[] {
    const rows = this.db.prepare('SELECT symbol FROM instruments').all() as Array<{
      symbol: string;
    }>;
    return rows.map((r) => r.symbol);
  }

  getActiveInstrumentsByType(
    type: 'equity' | 'index',
  ): Array<{ symbol: string; market_cap_band: string | null; sector: string | null }> {
    const rows = this.db
      .prepare(
        'SELECT symbol, market_cap_band, sector FROM instruments WHERE instrument_type = ? AND is_active = 1',
      )
      .all(type) as Array<{
      symbol: string;
      market_cap_band: string | null;
      sector: string | null;
    }>;
    return rows;
  }

  getMarketBrief(date?: string): {
    as_of: string;
    regime: {
      nifty_close: number;
      vs_ema50: number;
      vs_ema200: number;
      ema50_slope: number | null;
      stage: number | null;
      sniper_score: number | null;
      sniper_verdict: string | null;
    } | null;
    cap_rotation: {
      large_rs_vs_broad: number | null;
      mid_rs_vs_broad: number | null;
      small_rs_vs_broad: number | null;
    };
    top_sectors: Array<{
      sector: string;
      index: string;
      return_1w: number | null;
      return_1m: number | null;
      rs_rank: number;
      pct_members_uptrend: number | null;
      pct_members_stage2: number | null;
      avg_member_rs: number | null;
      top_stock: string | null;
      rs_rank_change_1w: number;
      rotation_signal: string;
    }>;
    scan_density: Record<string, number>;
    top_setups: Array<{
      symbol: string;
      name: string | null;
      setup_type: string;
      setup_quality: number | null;
      stage: number | null;
      sniper_score: number | null;
      sniper_verdict: string | null;
      composite_score: number | null;
      tf_alignment_score: number | null;
      candle_pattern: string | null;
      rvol: number | null;
      dist_52wk_high_pct: number | null;
      rs_rank_in_segment: number | null;
    }>;
    watchlist_alerts: Array<{
      symbol: string;
      alert: string;
      close: number;
      rvol: number | null;
      setup_type: string | null;
      sniper_score: number | null;
    }>;
    breadth: MarketStateRow | null;
  } {
    // 1. Determine as_of date
    const latestRow = this.db.prepare('SELECT MAX(date) as d FROM indicators_daily').get() as {
      d: string | null;
    };
    const asOf = date ?? latestRow.d ?? new Date().toISOString().slice(0, 10);

    // 2. Regime — query ^NSEI
    let regime: ReturnType<typeof this.getMarketBrief>['regime'] = null;
    const niftyRow = this.db
      .prepare(
        `SELECT o.close, id.ema_50, id.ema_200, id.ema_50_slope, id.stage,
                id.sniper_score, id.sniper_verdict
         FROM indicators_daily id
         JOIN ohlcv_daily o ON id.symbol = o.symbol AND id.date = o.date
         WHERE id.symbol = '^NSEI' AND id.date = ?`,
      )
      .get(asOf) as
      | {
          close: number;
          ema_50: number | null;
          ema_200: number | null;
          ema_50_slope: number | null;
          stage: number | null;
          sniper_score: number | null;
          sniper_verdict: string | null;
        }
      | undefined;

    if (niftyRow) {
      regime = {
        nifty_close: niftyRow.close,
        vs_ema50: niftyRow.ema_50 !== null ? (niftyRow.close > niftyRow.ema_50 ? 1 : 0) : 0,
        vs_ema200: niftyRow.ema_200 !== null ? (niftyRow.close > niftyRow.ema_200 ? 1 : 0) : 0,
        ema50_slope: niftyRow.ema_50_slope,
        stage: niftyRow.stage,
        sniper_score: niftyRow.sniper_score,
        sniper_verdict: niftyRow.sniper_verdict,
      };
    }

    // 3. Cap rotation — try named cap indexes first, fall back to equity avg per band
    // Build a symbol→rs map from the named index rows
    const capIndexSymbolRows = this.db
      .prepare(
        `SELECT id.symbol, id.rs_vs_broad
         FROM indicators_daily id
         WHERE id.symbol IN ('^CNX100', '^NSMIDCP100', '^CNXSC') AND id.date = ?`,
      )
      .all(asOf) as Array<{ symbol: string; rs_vs_broad: number | null }>;

    const capIndexMap = new Map<string, number | null>();
    for (const r of capIndexSymbolRows) {
      capIndexMap.set(r.symbol, r.rs_vs_broad);
    }

    let largeRs: number | null = capIndexMap.get('^CNX100') ?? null;
    let midRs: number | null = capIndexMap.get('^NSMIDCP100') ?? null;
    let smallRs: number | null = capIndexMap.get('^CNXSC') ?? null;

    if (largeRs === null || midRs === null || smallRs === null) {
      // Fall back to equity average per band
      const bandRows = this.db
        .prepare(
          `SELECT i.market_cap_band, AVG(id.rs_vs_broad) as avg_rs
           FROM indicators_daily id
           JOIN instruments i ON id.symbol = i.symbol
           WHERE id.date = ? AND i.instrument_type = 'equity' AND i.market_cap_band IS NOT NULL
           GROUP BY i.market_cap_band`,
        )
        .all(asOf) as Array<{ market_cap_band: string; avg_rs: number | null }>;
      for (const r of bandRows) {
        const band = r.market_cap_band?.toLowerCase();
        if (band === 'large' && largeRs === null) largeRs = r.avg_rs;
        else if (band === 'mid' && midRs === null) midRs = r.avg_rs;
        else if (band === 'small' && smallRs === null) smallRs = r.avg_rs;
      }
    }

    const capRotation = {
      large_rs_vs_broad: largeRs,
      mid_rs_vs_broad: midRs,
      small_rs_vs_broad: smallRs,
    };

    // 4. Top sectors — use sector_state_daily if available, else compute dynamically
    const sectorStateRows = this.db
      .prepare(
        `SELECT sector, sector_index_symbol, rs_rank, rs_rank_delta_1w,
                sector_return_1w, sector_return_1m,
                pct_members_uptrend, pct_members_stage2,
                avg_member_rs, top_stock_symbol
         FROM sector_state_daily WHERE date = ? ORDER BY rs_rank DESC LIMIT 5`,
      )
      .all(asOf) as Array<{
      sector: string;
      sector_index_symbol: string | null;
      rs_rank: number | null;
      rs_rank_delta_1w: number | null;
      sector_return_1w: number | null;
      sector_return_1m: number | null;
      pct_members_uptrend: number | null;
      pct_members_stage2: number | null;
      avg_member_rs: number | null;
      top_stock_symbol: string | null;
    }>;

    let topSectors: Array<{
      sector: string;
      index: string;
      return_1w: number | null;
      return_1m: number | null;
      rs_rank: number;
      pct_members_uptrend: number | null;
      pct_members_stage2: number | null;
      avg_member_rs: number | null;
      top_stock: string | null;
      rs_rank_change_1w: number;
      rotation_signal: string;
    }>;

    if (sectorStateRows.length > 0) {
      // Use pre-computed sector_state_daily
      topSectors = sectorStateRows.map((r) => {
        const rsRankDelta = r.rs_rank_delta_1w ?? 0;
        return {
          sector: r.sector,
          index: r.sector_index_symbol ?? '',
          return_1w: r.sector_return_1w,
          return_1m: r.sector_return_1m,
          rs_rank: r.rs_rank ?? 0,
          pct_members_uptrend: r.pct_members_uptrend,
          pct_members_stage2: r.pct_members_stage2,
          avg_member_rs: r.avg_member_rs,
          top_stock: r.top_stock_symbol,
          rs_rank_change_1w: rsRankDelta,
          rotation_signal:
            rsRankDelta > 5 ? 'improving' : rsRankDelta < -5 ? 'deteriorating' : 'stable',
        };
      });
    } else {
      // Dynamic fallback
      // Get date 5 trading days ago
      const fiveDaysAgoRows = this.db
        .prepare(
          'SELECT DISTINCT date FROM indicators_daily WHERE date < ? ORDER BY date DESC LIMIT 5',
        )
        .all(asOf) as Array<{ date: string }>;
      const prevDate = fiveDaysAgoRows[fiveDaysAgoRows.length - 1]?.date ?? null;

      // Get sector indexes
      const sectorIndexes = this.db
        .prepare(
          `SELECT symbol, name FROM instruments
           WHERE instrument_type = 'index' AND index_category = 'sector' AND is_active = 1`,
        )
        .all() as Array<{ symbol: string; name: string }>;

      const sectorDataArr: Array<{
        sector: string;
        index: string;
        return_1w: number | null;
        return_1m: number | null;
        return_1m_for_rank: number | null;
        pct_members_uptrend: number | null;
      }> = [];

      for (const idx of sectorIndexes) {
        const idxIndicators = this.db
          .prepare(
            `SELECT return_1w, return_1m FROM indicators_daily
             WHERE symbol = ? AND date = ?`,
          )
          .get(idx.symbol, asOf) as
          | { return_1w: number | null; return_1m: number | null }
          | undefined;

        // pct_members_uptrend: % of constituent members where close > ema_50
        const memberRows = this.db
          .prepare(
            `SELECT COUNT(*) as total,
                    SUM(CASE WHEN o.close > id.ema_50 THEN 1 ELSE 0 END) as uptrend
             FROM index_constituents ic
             JOIN indicators_daily id ON ic.member_symbol = id.symbol AND id.date = ?
             JOIN ohlcv_daily o ON ic.member_symbol = o.symbol AND o.date = ?
             WHERE ic.index_symbol = ?`,
          )
          .get(asOf, asOf, idx.symbol) as { total: number; uptrend: number } | undefined;

        const pctUptrend =
          memberRows && memberRows.total > 0 ? (memberRows.uptrend / memberRows.total) * 100 : null;

        sectorDataArr.push({
          sector: idx.name,
          index: idx.symbol,
          return_1w: idxIndicators?.return_1w ?? null,
          return_1m: idxIndicators?.return_1m ?? null,
          return_1m_for_rank: idxIndicators?.return_1m ?? null,
          pct_members_uptrend: pctUptrend,
        });
      }

      // Rank by return_1m (percentile 0-100)
      const validReturns = sectorDataArr
        .map((s) => s.return_1m_for_rank)
        .filter((v): v is number => v !== null);
      validReturns.sort((a, b) => a - b);

      function percentileRank(sortedVals: number[], target: number): number {
        if (sortedVals.length === 0) return 50;
        const below = sortedVals.filter((v) => v < target).length;
        return Math.round((below / sortedVals.length) * 100);
      }

      // Compute prev-date sector returns for rs_rank_change_1w
      const prevSectorReturns = new Map<string, number | null>();
      if (prevDate) {
        for (const idx of sectorIndexes) {
          const prevRow = this.db
            .prepare(`SELECT return_1m FROM indicators_daily WHERE symbol = ? AND date = ?`)
            .get(idx.symbol, prevDate) as { return_1m: number | null } | undefined;
          prevSectorReturns.set(idx.symbol, prevRow?.return_1m ?? null);
        }
      }

      // Build prev-date valid returns for ranking
      const prevValidReturns = Array.from(prevSectorReturns.values())
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);

      topSectors = sectorDataArr
        .map((s) => {
          const rsRank =
            s.return_1m_for_rank !== null ? percentileRank(validReturns, s.return_1m_for_rank) : 0;
          const prevReturn = prevSectorReturns.get(s.index) ?? null;
          const prevRsRank =
            prevReturn !== null ? percentileRank(prevValidReturns, prevReturn) : rsRank;
          const rsRankChange = rsRank - prevRsRank;
          const rotationSignal =
            rsRankChange > 5 ? 'improving' : rsRankChange < -5 ? 'deteriorating' : 'stable';
          return {
            sector: s.sector,
            index: s.index,
            return_1w: s.return_1w,
            return_1m: s.return_1m,
            rs_rank: rsRank,
            pct_members_uptrend: s.pct_members_uptrend,
            pct_members_stage2: null,
            avg_member_rs: null,
            top_stock: null,
            rs_rank_change_1w: rsRankChange,
            rotation_signal: rotationSignal,
          };
        })
        .sort((a, b) => b.rs_rank - a.rs_rank)
        .slice(0, 5);
    }

    // 5. Scan density
    const KEY_SCAN_IDS = [
      'base_breakout',
      'breakout_confirmed',
      'pullback_to_ema50',
      'momentum_surge',
      'oversold_bounce_candidate',
    ];
    const scanDensity: Record<string, number> = {};
    for (const scanId of KEY_SCAN_IDS) {
      const scanRow = this.db
        .prepare('SELECT sql_template FROM saved_scans WHERE scan_id = ?')
        .get(scanId) as { sql_template: string } | undefined;
      if (!scanRow) continue;
      try {
        const countRow = this.db
          .prepare(
            `SELECT COUNT(*) as cnt
             FROM indicators_daily id
             JOIN instruments i ON id.symbol = i.symbol
             WHERE id.date = ? AND i.instrument_type = 'equity' AND i.is_active = 1
             AND (${scanRow.sql_template})`,
          )
          .get(asOf) as { cnt: number };
        scanDensity[scanId] = countRow.cnt;
      } catch {
        // Invalid sql_template — skip
      }
    }

    // 6. Top setups
    const setupRows = this.db
      .prepare(
        `SELECT id.symbol, i.name, id.setup_type, id.setup_quality, id.stage,
                id.sniper_score, id.sniper_verdict, id.composite_score, id.tf_alignment_score,
                id.candle_pattern, id.rvol, id.dist_52wk_high_pct, id.rs_rank_in_segment
         FROM indicators_daily id
         JOIN instruments i ON id.symbol = i.symbol
         WHERE id.date = ? AND i.instrument_type = 'equity' AND i.is_active = 1
         AND id.setup_type IS NOT NULL AND id.composite_score IS NOT NULL
         ORDER BY id.composite_score DESC
         LIMIT 10`,
      )
      .all(asOf) as Array<{
      symbol: string;
      name: string | null;
      setup_type: string;
      setup_quality: number | null;
      stage: number | null;
      sniper_score: number | null;
      sniper_verdict: string | null;
      composite_score: number | null;
      tf_alignment_score: number | null;
      candle_pattern: string | null;
      rvol: number | null;
      dist_52wk_high_pct: number | null;
      rs_rank_in_segment: number | null;
    }>;

    const topSetups = setupRows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      setup_type: r.setup_type,
      setup_quality: r.setup_quality,
      stage: r.stage,
      sniper_score: r.sniper_score,
      sniper_verdict: r.sniper_verdict,
      composite_score: r.composite_score,
      tf_alignment_score: r.tf_alignment_score,
      candle_pattern: r.candle_pattern,
      rvol: r.rvol,
      dist_52wk_high_pct: r.dist_52wk_high_pct,
      rs_rank_in_segment: r.rs_rank_in_segment,
    }));

    // 7. Watchlist alerts
    const alertRows = this.db
      .prepare(
        `SELECT id.symbol, o.close, id.rvol, id.setup_type, id.sniper_score,
                id.dist_52wk_high_pct
         FROM indicators_daily id
         JOIN ohlcv_daily o ON id.symbol = o.symbol AND id.date = o.date
         JOIN watchlist w ON id.symbol = w.symbol
         WHERE id.date = ? AND (id.dist_52wk_high_pct <= 0.5 OR id.rvol >= 2.0 OR id.setup_type = 'stage2_entry')`,
      )
      .all(asOf) as Array<{
      symbol: string;
      close: number;
      rvol: number | null;
      setup_type: string | null;
      sniper_score: number | null;
      dist_52wk_high_pct: number | null;
    }>;

    const watchlistAlerts = alertRows.map((r) => {
      let alert: string;
      if (r.dist_52wk_high_pct !== null && r.dist_52wk_high_pct <= 0.5) {
        alert = 'new 52wk high';
      } else if (r.rvol !== null && r.rvol >= 2.0) {
        alert = 'volume surge';
      } else {
        alert = 'stage 2 entry';
      }
      return {
        symbol: r.symbol,
        alert,
        close: r.close,
        rvol: r.rvol,
        setup_type: r.setup_type,
        sniper_score: r.sniper_score,
      };
    });

    // 8. Breadth — from market_state_daily (populated by computeMarketState)
    const breadthRow = this.db
      .prepare('SELECT * FROM market_state_daily WHERE date = ?')
      .get(asOf) as MarketStateRow | undefined;
    const breadth = breadthRow ?? null;

    return {
      as_of: asOf,
      regime,
      cap_rotation: capRotation,
      top_sectors: topSectors,
      scan_density: scanDensity,
      top_setups: topSetups,
      watchlist_alerts: watchlistAlerts,
      breadth: breadth as MarketStateRow | null,
    };
  }

  // ---------------------------------------------------------------------------
  // Indicators
  // ---------------------------------------------------------------------------

  private getDeliveryData(symbol: string): Map<string, number | null> {
    const rows = this.db
      .prepare('SELECT date, delivery_pct FROM ohlcv_daily WHERE symbol = ? ORDER BY date ASC')
      .all(symbol) as Array<{ date: string; delivery_pct: number | null }>;
    const map = new Map<string, number | null>();
    for (const r of rows) {
      map.set(r.date, r.delivery_pct);
    }
    return map;
  }

  getLatestIndicatorsDate(): string {
    const row = this.db.prepare('SELECT MAX(date) as d FROM indicators_daily').get() as {
      d: string | null;
    };
    return row?.d ?? new Date().toISOString().slice(0, 10);
  }

  getIndicators(symbol: string, days = 63): IndicatorRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM indicators_daily
          WHERE symbol = ?
          ORDER BY date DESC
          LIMIT ?
        )
        ORDER BY date ASC`,
      )
      .all(symbol, days) as IndicatorRow[];
    return rows;
  }

  private buildIndicatorRows(
    symbol: string,
    ohlcvRows: OhlcvRow[],
    from: string | undefined,
    to: string,
    indexReturns: Map<string, Map<string, number>>,
    instrument: { market_cap_band: string | null; sector: string | null } | null,
    deliveryMap: Map<string, number | null>,
    athPrice: number | null,
  ): IndicatorRow[] {
    if (ohlcvRows.length === 0) return [];

    const closes = ohlcvRows.map((r) => r.close);
    const highs = ohlcvRows.map((r) => r.high);
    const lows = ohlcvRows.map((r) => r.low);
    const opens = ohlcvRows.map((r) => r.open);
    const volumes = ohlcvRows.map((r) => r.volume);
    const dates = ohlcvRows.map((r) => r.date);
    const N = closes.length;

    // Helper: get value at date index i from an indicator array of length L
    function atIndex<T>(arr: T[], i: number): T | null {
      const offset = N - arr.length;
      const idx = i - offset;
      return idx >= 0 && idx < arr.length ? (arr[idx] ?? null) : null;
    }

    // Compute all indicators
    const ema20 = computeEma(closes, 20);
    const ema50 = computeEma(closes, 50);
    const ema100 = computeEma(closes, 100);
    const ema200 = computeEma(closes, 200);
    const sma50 = computeSma(closes, 50);
    const sma200 = computeSma(closes, 200);
    const maStack = computeMaStack(closes, ema20, ema50, ema200);
    const ema50Slope = computeEmaSlope(ema50, 10);
    const rsi14 = computeRsi(closes, 14);
    const macdArr = computeMacd(closes);
    const adxArr = computeAdx(highs, lows, closes, 14);
    const stochArr = computeStochastic(highs, lows, closes, 14, 3);
    const cci20 = computeCci(highs, lows, closes, 20);
    const williamsR = computeWilliamsR(highs, lows, closes, 14);
    const psarArr = computePsar(highs, lows, closes);
    const roc5 = computeRoc(closes, 5);
    const atr14 = computeAtr(highs, lows, closes, 14);
    const adrPct = computeAdr(highs, lows, closes, 14);
    const bbArr = computeBollingerBands(closes, 20, 2);
    const keltnerArr = computeKeltnerChannels(highs, lows, closes, 20, 2);
    const donchianArr = computeDonchian(highs, lows, 20);
    const vwapArr = computeVwap(highs, lows, closes, volumes);
    const obvArr = computeObv(closes, volumes);
    const obvSlopeArr = computeObvSlope(obvArr, 5);
    const cprArr = computeClosePositionRatio(highs, lows, closes);
    const candleArr = detectCandlePatterns(opens, highs, lows, closes);
    const volSma20 = computeSma(volumes, 20);
    const closeSma20 = computeSma(closes, 20);

    // Weekly/monthly aggregation
    const weeklyBars = aggregateToWeekly(ohlcvRows);
    const monthlyBars = aggregateToMonthly(ohlcvRows);
    const wCloses = weeklyBars.map((r) => r.close);
    const mCloses = monthlyBars.map((r) => r.close);
    const wN = wCloses.length;
    const mN = mCloses.length;
    const ema20w = computeEma(wCloses, 20);
    const ema50w = computeEma(wCloses, 50);
    const rsi14w = computeRsi(wCloses, 14);
    const macdW = computeMacd(wCloses);
    const ema10m = computeEma(mCloses, 10);

    // Build date→weekly bar index map (for each daily date, find the most recent weekly bar date <= it)
    const weeklyDates = weeklyBars.map((r) => r.date);
    function findWeeklyIdx(dailyDate: string): number {
      let lo = 0;
      let hi = weeklyDates.length - 1;
      let result = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const wd = weeklyDates[mid];
        if (wd !== undefined && wd <= dailyDate) {
          result = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return result;
    }

    // Build date→monthly bar index map
    const monthlyDates = monthlyBars.map((r) => r.date);
    function findMonthlyIdx(dailyDate: string): number {
      const monthPrefix = dailyDate.slice(0, 7);
      let lo = 0;
      let hi = monthlyDates.length - 1;
      let result = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const md = monthlyDates[mid];
        if (md !== undefined && md.slice(0, 7) <= monthPrefix) {
          result = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return result;
    }

    // Helper for weekly indicator at a weekly bar index
    function atWeeklyIndex<T>(arr: T[], wIdx: number): T | null {
      const offset = wN - arr.length;
      const idx = wIdx - offset;
      return idx >= 0 && idx < arr.length ? (arr[idx] ?? null) : null;
    }

    // Helper for monthly indicator at a monthly bar index
    function atMonthlyIndex<T>(arr: T[], mIdx: number): T | null {
      const offset = mN - arr.length;
      const idx = mIdx - offset;
      return idx >= 0 && idx < arr.length ? (arr[idx] ?? null) : null;
    }

    // Determine which year's start for YTD calculation
    const currentYear = to.slice(0, 4);
    const yearStartStr = `${currentYear}-01-01`;

    // Find segment index symbol based on market_cap_band
    const mcb = instrument?.market_cap_band?.toLowerCase() ?? null;
    let segmentIndexSymbol: string | null = null;
    if (mcb === 'large') segmentIndexSymbol = '^CNX100';
    else if (mcb === 'mid') segmentIndexSymbol = '^NSMIDCP100';
    else if (mcb === 'small') segmentIndexSymbol = '^CNXSC';

    const result: IndicatorRow[] = [];
    let prevPsarSignal: number | null = null;

    for (let i = 0; i < N; i++) {
      const date = dates[i];
      if (date === undefined) continue;
      if (from && date < from) {
        // Still need to track previous psar signal for the from-offset boundary
        const psarVal = atIndex(psarArr, i);
        prevPsarSignal = psarVal !== null ? psarVal.signal : prevPsarSignal;
        continue;
      }
      if (date > to) break;

      // Moving averages
      const ema20Val = atIndex(ema20, i);
      const ema50Val = atIndex(ema50, i);
      const ema100Val = atIndex(ema100, i);
      const ema200Val = atIndex(ema200, i);
      const sma50Val = atIndex(sma50, i);
      const sma200Val = atIndex(sma200, i);
      const maStackVal = atIndex(maStack, i);
      const ema50SlopeVal = atIndex(ema50Slope, i);

      // Momentum
      const rsi14Val = atIndex(rsi14, i);
      const macdItem = atIndex(macdArr, i);
      const adxItem = atIndex(adxArr, i);
      const stochItem = atIndex(stochArr, i);
      const cci20Val = atIndex(cci20, i);
      const williamsRVal = atIndex(williamsR, i);
      const psarItem = atIndex(psarArr, i);
      const psarSignal = psarItem !== null ? psarItem.signal : null;
      const psarSignalPrev = prevPsarSignal;
      prevPsarSignal = psarSignal;
      const roc5Val = atIndex(roc5, i);

      // ATR / ADR / BB / Keltner / Donchian
      const atr14Val = atIndex(atr14, i);
      const adrVal = atIndex(adrPct, i);
      const bbItem = atIndex(bbArr, i);
      const keltnerItem = atIndex(keltnerArr, i);
      const donchianItem = atIndex(donchianArr, i);

      // VWAP / OBV / CPR
      const vwapItem = vwapArr[i];
      const obvVal = atIndex(obvArr, i);
      const obvSlopeVal = atIndex(obvSlopeArr, i);
      const cprVal = atIndex(cprArr, i);

      // Candle pattern (N-length, offset=0)
      const candlePattern = candleArr[i] ?? null;

      // Volume metrics
      const volSma20Val = atIndex(volSma20, i);
      const closeSma20Val = atIndex(closeSma20, i);
      const rvolVal =
        volSma20Val !== null && volSma20Val > 0 ? (volumes[i] ?? 0) / volSma20Val : null;
      const avgDollarVol20 =
        volSma20Val !== null && closeSma20Val !== null ? volSma20Val * closeSma20Val : null;

      // Delivery
      const delPct = deliveryMap.get(date) ?? null;
      // delivery_ma_20: compute from delivery map for last 20 days
      const deliveryWindow: number[] = [];
      for (let di = Math.max(0, i - 19); di <= i; di++) {
        const dd = dates[di];
        if (dd !== undefined) {
          const dp = deliveryMap.get(dd);
          if (dp !== null && dp !== undefined) deliveryWindow.push(dp);
        }
      }
      const deliveryMa20 =
        deliveryWindow.length > 0
          ? deliveryWindow.reduce((a, b) => a + b, 0) / deliveryWindow.length
          : null;

      // Returns
      const c = closes[i] ?? 0;
      const return1d = i >= 1 ? ((c - (closes[i - 1] ?? 0)) / (closes[i - 1] ?? 1)) * 100 : null;
      const return1w = i >= 5 ? ((c - (closes[i - 5] ?? 0)) / (closes[i - 5] ?? 1)) * 100 : null;
      const return1m = i >= 21 ? ((c - (closes[i - 21] ?? 0)) / (closes[i - 21] ?? 1)) * 100 : null;
      const return3m = i >= 63 ? ((c - (closes[i - 63] ?? 0)) / (closes[i - 63] ?? 1)) * 100 : null;
      const return6m =
        i >= 126 ? ((c - (closes[i - 126] ?? 0)) / (closes[i - 126] ?? 1)) * 100 : null;
      const return1y =
        i >= 252 ? ((c - (closes[i - 252] ?? 0)) / (closes[i - 252] ?? 1)) * 100 : null;

      // YTD return: find last price before Jan 1 of current year
      let returnYtd: number | null = null;
      if (date >= yearStartStr) {
        let ytdIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          const jd = dates[j];
          if (jd !== undefined && jd < yearStartStr) {
            ytdIdx = j;
            break;
          }
        }
        if (ytdIdx >= 0) {
          const base = closes[ytdIdx] ?? 0;
          returnYtd = base > 0 ? ((c - base) / base) * 100 : null;
        }
      }

      // 52W metrics
      const start52 = Math.max(0, i - 251);
      const highsWindow = highs.slice(start52, i + 1);
      const lowsWindow = lows.slice(start52, i + 1);
      const high52w = Math.max(...highsWindow);
      const low52w = Math.min(...lowsWindow);
      const dist52wkHighPct = high52w > 0 ? ((high52w - c) / high52w) * 100 : null;
      const dist52wkLowPct = low52w > 0 ? ((c - low52w) / low52w) * 100 : null;
      const pricePercentile52w = high52w > low52w ? ((c - low52w) / (high52w - low52w)) * 100 : 0;

      // ATH distance
      const distAthPct =
        athPrice !== null && athPrice > 0 ? ((athPrice - c) / athPrice) * 100 : null;

      // Distance from EMAs
      const pctFromEma20 =
        ema20Val !== null && ema20Val > 0 ? ((c - ema20Val) / ema20Val) * 100 : null;
      const pctFromEma50 =
        ema50Val !== null && ema50Val > 0 ? ((c - ema50Val) / ema50Val) * 100 : null;
      const pctFromEma200 =
        ema200Val !== null && ema200Val > 0 ? ((c - ema200Val) / ema200Val) * 100 : null;

      // RS calculations
      const return3mForRs = return3m;
      const segReturn3m =
        segmentIndexSymbol !== null
          ? (indexReturns.get(segmentIndexSymbol)?.get(date) ?? null)
          : null;
      const broadReturn3m = indexReturns.get('^CRSLDX')?.get(date) ?? null;
      const rsVsSegment =
        return3mForRs !== null && segReturn3m !== null ? return3mForRs - segReturn3m : null;
      const rsVsBroad =
        return3mForRs !== null && broadReturn3m !== null ? return3mForRs - broadReturn3m : null;

      // Weekly indicators for this daily date
      const wIdx = findWeeklyIdx(date);
      const ema20wVal = wIdx >= 0 ? atWeeklyIndex(ema20w, wIdx) : null;
      const ema50wVal = wIdx >= 0 ? atWeeklyIndex(ema50w, wIdx) : null;
      const rsi14wVal = wIdx >= 0 ? atWeeklyIndex(rsi14w, wIdx) : null;
      const macdWItem = wIdx >= 0 ? atWeeklyIndex(macdW, wIdx) : null;
      const wClose = wIdx >= 0 ? (weeklyBars[wIdx]?.close ?? null) : null;
      const closeVsEma20w =
        wClose !== null && ema20wVal !== null ? (wClose > ema20wVal ? 1 : 0) : null;
      const closeVsEma50w =
        wClose !== null && ema50wVal !== null ? (wClose > ema50wVal ? 1 : 0) : null;

      // Monthly indicators
      const mIdx = findMonthlyIdx(date);
      const ema10mVal = mIdx >= 0 ? atMonthlyIndex(ema10m, mIdx) : null;
      const mClose = mIdx >= 0 ? (monthlyBars[mIdx]?.close ?? null) : null;
      const closeVsEma10m =
        mClose !== null && ema10mVal !== null ? (mClose > ema10mVal ? 1 : 0) : null;

      // SMA200 slope
      const sma200Offset = N - sma200.length;
      const sma200Idx = i - sma200Offset;
      let sma200SlopeVal = 0;
      if (sma200Idx >= 10 && sma200.length > 0) {
        const cur = sma200[sma200Idx] ?? 0;
        const prev10 = sma200[sma200Idx - 10] ?? 0;
        sma200SlopeVal = prev10 > 0 ? (cur - prev10) / prev10 : 0;
      }

      // BB width contracting
      const bbOffset = N - bbArr.length;
      const bbIdx = i - bbOffset;
      const bbIdxMinus5 = bbIdx - 5;
      const bbCur = bbArr[bbIdx]?.width ?? null;
      const bbPrev5 = bbIdxMinus5 >= 0 ? (bbArr[bbIdxMinus5]?.width ?? null) : null;
      const bbWidthContracting = bbCur !== null && bbPrev5 !== null && bbCur < bbPrev5;

      // Stage
      const stageVal = computeStage({
        close: c,
        sma200: sma200Val ?? c,
        sma200Slope: sma200SlopeVal,
        maStack: maStackVal ?? 0,
        pricePercentile52w: pricePercentile52w,
        rsi14: rsi14Val ?? 50,
        macdHist: macdItem?.histogram ?? 0,
        bbWidthContracting,
        return1m: return1m ?? 0,
        rvol: rvolVal ?? 1,
      });

      // TF alignment score
      const tfAlignmentScore = computeTfAlignmentScore({
        maStack: maStackVal ?? 0,
        rsi14: rsi14Val ?? 50,
        macdHist: macdItem?.histogram ?? 0,
        closeVsEma20w: closeVsEma20w ?? 0,
        closeVsEma50w: closeVsEma50w ?? 0,
        rsi14Weekly: rsi14wVal ?? 50,
        closeVsEma10m: closeVsEma10m ?? 0,
        return3m: return3mForRs ?? 0,
      });

      // Sniper score (rs_rank_in_segment filled in Pass 2)
      const sniperResult = computeSniperScore({
        maStack: maStackVal ?? 0,
        macdHist: macdItem?.histogram ?? 0,
        macdHistPrev: null,
        psarSignal: psarSignal ?? 0,
        stage: stageVal,
        rsRankInSegment: null,
        rvol: rvolVal ?? 1,
        closedAboveVwap: vwapItem?.closedAbove ?? 0,
        tfAlignmentScore: tfAlignmentScore,
      });

      // Composite score
      const compositeResult = computeCompositeScore(sniperResult.score);

      // Setup type
      const setupResult = computeSetupType({
        bbWidthBottom20pct: false,
        dist52wkHighPct: dist52wkHighPct ?? 100,
        tfAlignmentScore: tfAlignmentScore,
        stage: stageVal,
        rvol: rvolVal ?? 1,
        closedAboveVwap: vwapItem?.closedAbove ?? 0,
        pctFromEma20: pctFromEma20 ?? 0,
        rsi14: rsi14Val ?? 50,
        pctFromEma50: pctFromEma50 ?? 0,
        closeVsEma50w: closeVsEma50w ?? 0,
        pctFromEma200: pctFromEma200 ?? 0,
        closeVsEma20w: closeVsEma20w ?? 0,
        maStack: maStackVal ?? 0,
        return1m: return1m ?? 0,
        candlePattern: candlePattern,
        pctFromEma50Pos: pctFromEma50 ?? 0,
        rsi14Level: rsi14Val ?? 50,
      });

      // Prev MACD hist for sniper score (requires prev row's macd_hist)
      // We compute macdHistPrev inline using the previous bar index
      const prevMacdItem = i > 0 ? atIndex(macdArr, i - 1) : null;
      const macdHistPrev = prevMacdItem !== null ? prevMacdItem.histogram : null;

      result.push({
        symbol,
        date,
        ema_20: ema20Val,
        ema_50: ema50Val,
        ema_100: ema100Val,
        ema_200: ema200Val,
        sma_50: sma50Val,
        sma_200: sma200Val,
        ma_stack: maStackVal,
        ema_50_slope: ema50SlopeVal,
        rsi_14: rsi14Val,
        macd: macdItem?.macd ?? null,
        macd_signal: macdItem?.signal ?? null,
        macd_hist: macdItem?.histogram ?? null,
        macd_hist_prev: macdHistPrev,
        adx: adxItem?.adx ?? null,
        adx_di_plus: adxItem?.diPlus ?? null,
        adx_di_minus: adxItem?.diMinus ?? null,
        stoch_k: stochItem?.k ?? null,
        stoch_d: stochItem?.d ?? null,
        cci_20: cci20Val,
        williams_r: williamsRVal,
        psar: psarItem?.psar ?? null,
        psar_signal: psarSignal,
        psar_signal_prev: psarSignalPrev,
        roc_5: roc5Val,
        return_1d: return1d,
        return_1w: return1w,
        return_1m: return1m,
        return_3m: return3m,
        return_6m: return6m,
        return_1y: return1y,
        return_ytd: returnYtd,
        rs_vs_segment: rsVsSegment,
        rs_vs_broad: rsVsBroad,
        rs_rank_in_segment: null,
        rs_rank_in_sector: null,
        atr_14: atr14Val,
        adr_pct: adrVal,
        bb_upper: bbItem?.upper ?? null,
        bb_lower: bbItem?.lower ?? null,
        bb_middle: bbItem?.middle ?? null,
        bb_width: bbItem?.width ?? null,
        keltner_upper: keltnerItem?.upper ?? null,
        keltner_lower: keltnerItem?.lower ?? null,
        donchian_upper_20: donchianItem?.upper ?? null,
        donchian_lower_20: donchianItem?.lower ?? null,
        rvol: rvolVal,
        vol_sma_20: volSma20Val,
        avg_dollar_volume_20: avgDollarVol20,
        delivery_pct: delPct,
        delivery_ma_20: deliveryMa20 !== null && deliveryWindow.length > 0 ? deliveryMa20 : null,
        obv: obvVal,
        obv_slope_5d: obvSlopeVal,
        close_position_ratio: cprVal,
        vwap: vwapItem?.vwap ?? null,
        closed_above_vwap: vwapItem?.closedAbove ?? null,
        dist_52wk_high_pct: dist52wkHighPct,
        dist_52wk_low_pct: dist52wkLowPct,
        dist_ath_pct: distAthPct,
        pct_from_ema20: pctFromEma20,
        pct_from_ema50: pctFromEma50,
        pct_from_ema200: pctFromEma200,
        price_percentile_52w: pricePercentile52w,
        candle_pattern: candlePattern,
        ema_20_weekly: ema20wVal,
        ema_50_weekly: ema50wVal,
        close_vs_ema20w: closeVsEma20w,
        close_vs_ema50w: closeVsEma50w,
        rsi_14_weekly: rsi14wVal,
        macd_hist_weekly: macdWItem?.histogram ?? null,
        ema_10_monthly: ema10mVal,
        close_vs_ema10m: closeVsEma10m,
        tf_alignment_score: tfAlignmentScore,
        stage: stageVal,
        sniper_score: sniperResult.score,
        sniper_verdict: sniperResult.verdict,
        composite_score: compositeResult.score,
        composite_grade: compositeResult.grade,
        setup_type: setupResult.setupType,
        setup_quality: setupResult.setupQuality,
      });
    }

    return result;
  }

  async computeIndicators(opts: {
    symbol?: string;
    from?: string;
    to?: string;
    adjusted?: boolean;
  }): Promise<{ processed: number; dateCount: number }> {
    const toDate = opts.to ?? new Date().toISOString().slice(0, 10);

    // Step 1: Determine symbols
    let symbols: string[];
    if (opts.symbol) {
      symbols = [opts.symbol];
    } else {
      const rows = this.db
        .prepare('SELECT symbol FROM instruments WHERE is_active = 1')
        .all() as Array<{ symbol: string }>;
      symbols = rows.map((r) => r.symbol);
    }

    // Step 2: Pre-compute segment/broad index returns
    const indexSymbols = ['^CNX100', '^NSMIDCP100', '^CNXSC', '^CRSLDX'];
    const indexReturns = new Map<string, Map<string, number>>();
    for (const idxSym of indexSymbols) {
      const idxRows = this.db
        .prepare(
          `SELECT symbol, date, open, high, low, close, volume, adj_close
           FROM ohlcv_daily WHERE symbol = ? ORDER BY date ASC`,
        )
        .all(idxSym) as Array<{
        symbol: string;
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        adj_close: number | null;
      }>;
      if (idxRows.length === 0) continue;
      const idxCloses = idxRows.map((r) =>
        opts.adjusted && r.adj_close !== null ? r.adj_close : r.close,
      );
      const idxDates = idxRows.map((r) => r.date);
      const idxN = idxCloses.length;
      const dateMap = new Map<string, number>();
      for (let i = 0; i < idxN; i++) {
        const d = idxDates[i];
        const c = idxCloses[i];
        if (d === undefined || c === undefined) continue;
        if (i >= 63) {
          const prev63 = idxCloses[i - 63] ?? 0;
          const ret3m = prev63 > 0 ? ((c - prev63) / prev63) * 100 : 0;
          dateMap.set(d, ret3m);
        }
      }
      indexReturns.set(idxSym, dateMap);
    }

    // Step 3: Build prepared statement for upsert
    const upsertSql = `
      INSERT OR REPLACE INTO indicators_daily
      (symbol, date, ema_20, ema_50, ema_100, ema_200, sma_50, sma_200, ma_stack, ema_50_slope,
       rsi_14, macd, macd_signal, macd_hist, macd_hist_prev, adx, adx_di_plus, adx_di_minus,
       stoch_k, stoch_d, cci_20, williams_r, psar, psar_signal, psar_signal_prev, roc_5,
       return_1d, return_1w, return_1m, return_3m, return_6m, return_1y, return_ytd,
       rs_vs_segment, rs_vs_broad, rs_rank_in_segment, rs_rank_in_sector,
       atr_14, adr_pct, bb_upper, bb_lower, bb_middle, bb_width, keltner_upper, keltner_lower,
       donchian_upper_20, donchian_lower_20, rvol, vol_sma_20, avg_dollar_volume_20,
       delivery_pct, delivery_ma_20, obv, obv_slope_5d, close_position_ratio,
       vwap, closed_above_vwap, dist_52wk_high_pct, dist_52wk_low_pct, dist_ath_pct,
       pct_from_ema20, pct_from_ema50, pct_from_ema200, price_percentile_52w, candle_pattern,
       ema_20_weekly, ema_50_weekly, close_vs_ema20w, close_vs_ema50w, rsi_14_weekly,
       macd_hist_weekly, ema_10_monthly, close_vs_ema10m, tf_alignment_score, stage,
       sniper_score, sniper_verdict, composite_score, composite_grade, setup_type, setup_quality)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;
    const upsertStmt = this.db.prepare(upsertSql);

    // Step 4: Pass 1 — Per-symbol indicator computation
    let processed = 0;
    const datesProcessed = new Set<string>();

    for (const symbol of symbols) {
      // Load all OHLCV history for this symbol (sorted ASC)
      const rawRows = this.db
        .prepare(
          `SELECT symbol, date, open, high, low, close, volume, adj_close
           FROM ohlcv_daily WHERE symbol = ? ORDER BY date ASC`,
        )
        .all(symbol) as Array<{
        symbol: string;
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        adj_close: number | null;
      }>;
      if (rawRows.length === 0) continue;
      const ohlcvRows: OhlcvRow[] = rawRows.map((r) => ({
        symbol: r.symbol,
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: opts.adjusted && r.adj_close !== null ? r.adj_close : r.close,
        volume: r.volume,
        adjClose: r.adj_close,
      }));

      // Load ATH price
      const athRow = this.db
        .prepare('SELECT ath_price FROM ath_tracker WHERE symbol = ?')
        .get(symbol) as { ath_price: number } | undefined;
      const athPrice = athRow?.ath_price ?? null;

      // Load delivery data
      const deliveryMap = this.getDeliveryData(symbol);

      // Load instrument metadata
      const instrRow = this.db
        .prepare('SELECT market_cap_band, sector FROM instruments WHERE symbol = ?')
        .get(symbol) as { market_cap_band: string | null; sector: string | null } | undefined;
      const instrument = instrRow ?? null;

      // Build indicator rows
      const rows = this.buildIndicatorRows(
        symbol,
        ohlcvRows,
        opts.from,
        toDate,
        indexReturns,
        instrument,
        deliveryMap,
        athPrice,
      );

      if (rows.length === 0) continue;

      // Batch upsert in a transaction
      const insertTx = this.db.transaction((items: IndicatorRow[]) => {
        for (const r of items) {
          upsertStmt.run(
            r.symbol,
            r.date,
            r.ema_20,
            r.ema_50,
            r.ema_100,
            r.ema_200,
            r.sma_50,
            r.sma_200,
            r.ma_stack,
            r.ema_50_slope,
            r.rsi_14,
            r.macd,
            r.macd_signal,
            r.macd_hist,
            r.macd_hist_prev,
            r.adx,
            r.adx_di_plus,
            r.adx_di_minus,
            r.stoch_k,
            r.stoch_d,
            r.cci_20,
            r.williams_r,
            r.psar,
            r.psar_signal,
            r.psar_signal_prev,
            r.roc_5,
            r.return_1d,
            r.return_1w,
            r.return_1m,
            r.return_3m,
            r.return_6m,
            r.return_1y,
            r.return_ytd,
            r.rs_vs_segment,
            r.rs_vs_broad,
            r.rs_rank_in_segment,
            r.rs_rank_in_sector,
            r.atr_14,
            r.adr_pct,
            r.bb_upper,
            r.bb_lower,
            r.bb_middle,
            r.bb_width,
            r.keltner_upper,
            r.keltner_lower,
            r.donchian_upper_20,
            r.donchian_lower_20,
            r.rvol,
            r.vol_sma_20,
            r.avg_dollar_volume_20,
            r.delivery_pct,
            r.delivery_ma_20,
            r.obv,
            r.obv_slope_5d,
            r.close_position_ratio,
            r.vwap,
            r.closed_above_vwap,
            r.dist_52wk_high_pct,
            r.dist_52wk_low_pct,
            r.dist_ath_pct,
            r.pct_from_ema20,
            r.pct_from_ema50,
            r.pct_from_ema200,
            r.price_percentile_52w,
            r.candle_pattern,
            r.ema_20_weekly,
            r.ema_50_weekly,
            r.close_vs_ema20w,
            r.close_vs_ema50w,
            r.rsi_14_weekly,
            r.macd_hist_weekly,
            r.ema_10_monthly,
            r.close_vs_ema10m,
            r.tf_alignment_score,
            r.stage,
            r.sniper_score,
            r.sniper_verdict,
            r.composite_score,
            r.composite_grade,
            r.setup_type,
            r.setup_quality,
          );
          datesProcessed.add(r.date);
        }
      });
      insertTx(rows);
      processed++;
    }

    // Step 5: Pass 2 — Cross-sectional (percentile ranks, re-compute sniper/composite/setup)
    const allDates = Array.from(datesProcessed).sort();
    for (const date of allDates) {
      const crossRows = this.db
        .prepare(
          `SELECT id.symbol, id.return_3m, id.sniper_score, id.tf_alignment_score,
                  id.psar_signal, id.macd_hist, id.macd_hist_prev, id.ma_stack,
                  id.stage, id.rvol, id.closed_above_vwap, id.rsi_14,
                  i.market_cap_band, i.sector
           FROM indicators_daily id
           JOIN instruments i ON id.symbol = i.symbol
           WHERE id.date = ? AND i.instrument_type = 'equity' AND i.is_active = 1`,
        )
        .all(date) as Array<{
        symbol: string;
        return_3m: number | null;
        sniper_score: number | null;
        tf_alignment_score: number | null;
        psar_signal: number | null;
        macd_hist: number | null;
        macd_hist_prev: number | null;
        ma_stack: number | null;
        stage: number | null;
        rvol: number | null;
        closed_above_vwap: number | null;
        rsi_14: number | null;
        market_cap_band: string | null;
        sector: string | null;
      }>;

      if (crossRows.length === 0) continue;

      // Compute percentile ranks by market_cap_band and sector
      function percentileRank(values: number[], target: number): number {
        if (values.length === 0) return 50;
        const below = values.filter((v) => v < target).length;
        return Math.round((below / values.length) * 100);
      }

      // Group return_3m by market_cap_band and sector
      const bandGroups = new Map<string, number[]>();
      const sectorGroups = new Map<string, number[]>();
      for (const r of crossRows) {
        if (r.return_3m !== null) {
          const band = r.market_cap_band ?? 'unknown';
          if (!bandGroups.has(band)) bandGroups.set(band, []);
          bandGroups.get(band)?.push(r.return_3m);

          const sec = r.sector ?? 'unknown';
          if (!sectorGroups.has(sec)) sectorGroups.set(sec, []);
          sectorGroups.get(sec)?.push(r.return_3m);
        }
      }

      // Update each row with percentile ranks + re-computed sniper/composite/setup
      const updateStmt = this.db.prepare(
        `UPDATE indicators_daily
         SET rs_rank_in_segment=?, rs_rank_in_sector=?,
             sniper_score=?, sniper_verdict=?,
             composite_score=?, composite_grade=?,
             setup_type=?, setup_quality=?
         WHERE symbol=? AND date=?`,
      );
      const updateTx = this.db.transaction(() => {
        for (const r of crossRows) {
          const band = r.market_cap_band ?? 'unknown';
          const sec = r.sector ?? 'unknown';
          const bandVals = bandGroups.get(band) ?? [];
          const sectorVals = sectorGroups.get(sec) ?? [];
          const rsRankInSegment =
            r.return_3m !== null ? percentileRank(bandVals, r.return_3m) : null;
          const rsRankInSector =
            r.return_3m !== null ? percentileRank(sectorVals, r.return_3m) : null;

          // Re-compute sniper score with now-known rs_rank_in_segment
          // We need more context from indicators_daily for this symbol/date
          const idRow = this.db
            .prepare(
              `SELECT ma_stack, macd_hist, macd_hist_prev, psar_signal, stage,
                      rvol, closed_above_vwap, tf_alignment_score
               FROM indicators_daily WHERE symbol=? AND date=?`,
            )
            .get(r.symbol, date) as
            | {
                ma_stack: number | null;
                macd_hist: number | null;
                macd_hist_prev: number | null;
                psar_signal: number | null;
                stage: number | null;
                rvol: number | null;
                closed_above_vwap: number | null;
                tf_alignment_score: number | null;
              }
            | undefined;

          if (!idRow) continue;

          const sniperResult = computeSniperScore({
            maStack: idRow.ma_stack ?? 0,
            macdHist: idRow.macd_hist ?? 0,
            macdHistPrev: idRow.macd_hist_prev ?? null,
            psarSignal: idRow.psar_signal ?? 0,
            stage: idRow.stage ?? 1,
            rsRankInSegment: rsRankInSegment,
            rvol: idRow.rvol ?? 1,
            closedAboveVwap: idRow.closed_above_vwap ?? 0,
            tfAlignmentScore: idRow.tf_alignment_score ?? 0,
          });
          const compositeResult = computeCompositeScore(sniperResult.score);

          // Setup type — need additional columns
          const setupRow = this.db
            .prepare(
              `SELECT dist_52wk_high_pct, tf_alignment_score, rvol, closed_above_vwap,
                      pct_from_ema20, rsi_14, pct_from_ema50, close_vs_ema50w,
                      pct_from_ema200, close_vs_ema20w, ma_stack, return_1m,
                      candle_pattern, stage
               FROM indicators_daily WHERE symbol=? AND date=?`,
            )
            .get(r.symbol, date) as
            | {
                dist_52wk_high_pct: number | null;
                tf_alignment_score: number | null;
                rvol: number | null;
                closed_above_vwap: number | null;
                pct_from_ema20: number | null;
                rsi_14: number | null;
                pct_from_ema50: number | null;
                close_vs_ema50w: number | null;
                pct_from_ema200: number | null;
                close_vs_ema20w: number | null;
                ma_stack: number | null;
                return_1m: number | null;
                candle_pattern: string | null;
                stage: number | null;
              }
            | undefined;

          const setupResult = setupRow
            ? computeSetupType({
                bbWidthBottom20pct: false,
                dist52wkHighPct: setupRow.dist_52wk_high_pct ?? 100,
                tfAlignmentScore: setupRow.tf_alignment_score ?? 0,
                stage: setupRow.stage ?? 1,
                rvol: setupRow.rvol ?? 1,
                closedAboveVwap: setupRow.closed_above_vwap ?? 0,
                pctFromEma20: setupRow.pct_from_ema20 ?? 0,
                rsi14: setupRow.rsi_14 ?? 50,
                pctFromEma50: setupRow.pct_from_ema50 ?? 0,
                closeVsEma50w: setupRow.close_vs_ema50w ?? 0,
                pctFromEma200: setupRow.pct_from_ema200 ?? 0,
                closeVsEma20w: setupRow.close_vs_ema20w ?? 0,
                maStack: setupRow.ma_stack ?? 0,
                return1m: setupRow.return_1m ?? 0,
                candlePattern: setupRow.candle_pattern ?? null,
                pctFromEma50Pos: setupRow.pct_from_ema50 ?? 0,
                rsi14Level: setupRow.rsi_14 ?? 50,
              })
            : { setupType: null as string | null, setupQuality: 0 };

          updateStmt.run(
            rsRankInSegment,
            rsRankInSector,
            sniperResult.score,
            sniperResult.verdict,
            compositeResult.score,
            compositeResult.grade,
            setupResult.setupType,
            setupResult.setupQuality,
            r.symbol,
            date,
          );
        }
      });
      updateTx();
    }

    // Step 6: Pass 3 — ATH update
    for (const symbol of symbols) {
      const highRow = this.db
        .prepare(
          'SELECT MAX(high) as max_high, date FROM ohlcv_daily WHERE symbol = ? AND date <= ?',
        )
        .get(symbol, toDate) as { max_high: number | null; date: string | null } | undefined;
      if (!highRow?.max_high || !highRow?.date) continue;

      // Find the date of that max high
      const maxHighDateRow = this.db
        .prepare(
          'SELECT date FROM ohlcv_daily WHERE symbol = ? AND high = ? ORDER BY date DESC LIMIT 1',
        )
        .get(symbol, highRow.max_high) as { date: string } | undefined;
      const athDate = maxHighDateRow?.date ?? highRow.date;

      const existing = this.db
        .prepare('SELECT ath_price FROM ath_tracker WHERE symbol = ?')
        .get(symbol) as { ath_price: number } | undefined;

      if (!existing || highRow.max_high > existing.ath_price) {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO ath_tracker (symbol, ath_price, ath_date) VALUES (?, ?, ?)',
          )
          .run(symbol, highRow.max_high, athDate);
      }
    }

    return { processed, dateCount: datesProcessed.size };
  }

  computeMarketState(opts: { from?: string; to?: string } = {}): { processed: number } {
    // Get list of dates to process from indicators_daily
    const conditions: string[] = [];
    if (opts.from) conditions.push(`date >= '${opts.from}'`);
    if (opts.to) conditions.push(`date <= '${opts.to}'`);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const dates = (
      this.db
        .prepare(`SELECT DISTINCT date FROM indicators_daily ${whereClause} ORDER BY date ASC`)
        .all() as Array<{ date: string }>
    ).map((r) => r.date);

    let processed = 0;

    for (const date of dates) {
      // Get all active equities with their indicator + ohlcv data for this date
      const rows = this.db
        .prepare(`
        SELECT id.symbol, o.open, o.close, o.volume,
               id.return_1d, id.ema_50, id.ema_200, id.stage, id.rsi_14, id.macd_hist,
               id.adx, id.rvol, id.closed_above_vwap, id.ma_stack, id.bb_width,
               id.dist_52wk_high_pct, id.dist_52wk_low_pct
        FROM indicators_daily id
        JOIN instruments i ON id.symbol = i.symbol
        JOIN ohlcv_daily o ON id.symbol = o.symbol AND o.date = id.date
        WHERE id.date = ? AND i.instrument_type = 'equity' AND i.is_active = 1
      `)
        .all(date) as Array<{
        symbol: string;
        open: number;
        close: number;
        volume: number;
        return_1d: number | null;
        ema_50: number | null;
        ema_200: number | null;
        stage: number | null;
        rsi_14: number | null;
        macd_hist: number | null;
        adx: number | null;
        rvol: number | null;
        closed_above_vwap: number | null;
        ma_stack: number | null;
        bb_width: number | null;
        dist_52wk_high_pct: number | null;
        dist_52wk_low_pct: number | null;
      }>;

      const total = rows.length;
      if (total === 0) continue;

      // Classic breadth
      const advances = rows.filter((r) => (r.return_1d ?? 0) > 0).length;
      const declines = rows.filter((r) => (r.return_1d ?? 0) < 0).length;
      const unchangedCount = total - advances - declines;
      const adRatio = declines > 0 ? advances / declines : advances;

      // MA breadth
      const abv50 = rows.filter((r) => r.ema_50 !== null && r.close > r.ema_50).length;
      const abv200 = rows.filter((r) => r.ema_200 !== null && r.close > r.ema_200).length;
      const pctAbove50ma = (abv50 / total) * 100;
      const pctAbove200ma = (abv200 / total) * 100;

      // New highs/lows
      const newHighs = rows.filter(
        (r) => r.dist_52wk_high_pct !== null && r.dist_52wk_high_pct <= 0,
      ).length;
      const newLows = rows.filter(
        (r) => r.dist_52wk_low_pct !== null && r.dist_52wk_low_pct <= 0,
      ).length;

      // Volume by direction
      const upVolume = rows.filter((r) => r.close >= r.open).reduce((s, r) => s + r.volume, 0);
      const downVolume = rows.filter((r) => r.close < r.open).reduce((s, r) => s + r.volume, 0);

      // % up/down >2%
      const pctUp2 = (rows.filter((r) => (r.return_1d ?? 0) > 2).length / total) * 100;
      const pctDown2 = (rows.filter((r) => (r.return_1d ?? 0) < -2).length / total) * 100;

      // VWAP breadth
      const pctAboveVwap = (rows.filter((r) => r.closed_above_vwap === 1).length / total) * 100;

      // Sniper Intelligence breadth
      const emaStackBullPct = (rows.filter((r) => (r.ma_stack ?? 0) >= 3).length / total) * 100;
      const macdBreadthPct = (rows.filter((r) => (r.macd_hist ?? 0) > 0).length / total) * 100;
      const adxTrendingPct = (rows.filter((r) => (r.adx ?? 0) > 25).length / total) * 100;

      // RSI stats
      const rsiValues = rows.map((r) => r.rsi_14).filter((v): v is number => v !== null);
      const avgRsi =
        rsiValues.length > 0 ? rsiValues.reduce((s, v) => s + v, 0) / rsiValues.length : null;
      const pctOversold =
        rsiValues.length > 0 ? (rsiValues.filter((v) => v < 35).length / total) * 100 : null;
      const pctOverbought =
        rsiValues.length > 0 ? (rsiValues.filter((v) => v > 70).length / total) * 100 : null;

      // Smart money proxies
      const smartMoneyAcc = rows.filter((r) => (r.rvol ?? 0) > 1.5 && r.close > r.open).length;
      const smartMoneyDist = rows.filter((r) => (r.rvol ?? 0) > 1.5 && r.close < r.open).length;

      // Volume surges
      const volSurgesCount = rows.filter((r) => (r.rvol ?? 0) >= 2.0).length;

      // Stage breadth
      const stage2Pct = (rows.filter((r) => r.stage === 2).length / total) * 100;
      const stage4Pct = (rows.filter((r) => r.stage === 4).length / total) * 100;

      // BB squeeze: bb_width in bottom 10th percentile of non-null values
      const bbWidths = rows
        .map((r) => r.bb_width)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);
      const bbSqueezeThreshold =
        bbWidths.length > 0 ? bbWidths[Math.floor(bbWidths.length * 0.1)] : null;
      const bbSqueezeCount =
        bbSqueezeThreshold !== null
          ? rows.filter((r) => r.bb_width !== null && r.bb_width <= bbSqueezeThreshold).length
          : 0;

      // India VIX
      const vixRow = this.db
        .prepare('SELECT close FROM ohlcv_daily WHERE symbol = ? AND date = ?')
        .get('^INDIAVIX', date) as { close: number } | undefined;
      const indiaVix = vixRow?.close ?? null;

      // Nifty reference from indicators_daily
      const niftyRow = this.db
        .prepare(`
        SELECT o.close, id.ema_50, id.ema_200, id.ema_50_slope, id.stage, id.sniper_score
        FROM indicators_daily id
        JOIN ohlcv_daily o ON id.symbol = o.symbol AND o.date = id.date
        WHERE id.symbol = '^NSEI' AND id.date = ?
      `)
        .get(date) as
        | {
            close: number;
            ema_50: number | null;
            ema_200: number | null;
            ema_50_slope: number | null;
            stage: number | null;
            sniper_score: number | null;
          }
        | undefined;

      const niftyClose = niftyRow?.close ?? null;
      const niftyVsEma50 =
        niftyRow && niftyRow.ema_50 !== null ? (niftyRow.close > niftyRow.ema_50 ? 1 : 0) : null;
      const niftyVsEma200 =
        niftyRow && niftyRow.ema_200 !== null ? (niftyRow.close > niftyRow.ema_200 ? 1 : 0) : null;

      // Mood score: ema50_breadth (20%) + ad_ratio_norm (15%) + pct_above_vwap (15%) +
      //   macd_breadth (15%) + ema200_breadth (10%) + hi_lo_norm (10%) +
      //   stage2_pct (10%) + avg_rsi_norm (5%)
      const adRatioNorm = Math.max(0, Math.min(100, ((adRatio - 0.2) / 4.8) * 100));
      const hiLoNorm =
        newHighs + newLows > 0 ? (((newHighs - newLows) / (newHighs + newLows) + 1) / 2) * 100 : 50;
      const avgRsiNorm =
        avgRsi !== null ? Math.max(0, Math.min(100, ((avgRsi - 30) / 40) * 100)) : 50;

      const moodScore = Math.round(
        pctAbove50ma * 0.2 +
          adRatioNorm * 0.15 +
          pctAboveVwap * 0.15 +
          macdBreadthPct * 0.15 +
          pctAbove200ma * 0.1 +
          hiLoNorm * 0.1 +
          stage2Pct * 0.1 +
          avgRsiNorm * 0.05,
      );

      // Upsert into market_state_daily
      this.db
        .prepare(`
        INSERT OR REPLACE INTO market_state_daily (
          date, nifty_close, nifty_vs_ema50, nifty_vs_ema200, nifty_ema50_slope,
          nifty_stage, nifty_sniper_score,
          advances, declines, unchanged_count, ad_ratio,
          pct_above_50ma, pct_above_200ma, new_highs, new_lows,
          up_volume, down_volume, pct_up_2, pct_down_2,
          pct_above_vwap,
          ema_stack_bull_pct, ema200_breadth_pct, ema50_breadth_pct,
          macd_breadth_pct, adx_trending_pct, avg_rsi, pct_oversold, pct_overbought,
          smart_money_acc_count, smart_money_dist_count,
          bull_divergence_count, bear_divergence_count,
          bb_squeeze_count, gap_ups_count, gap_downs_count,
          vol_surges_count, stage2_pct, stage4_pct, mood_score, india_vix
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?
        )
      `)
        .run(
          date,
          niftyClose,
          niftyVsEma50,
          niftyVsEma200,
          niftyRow?.ema_50_slope ?? null,
          niftyRow?.stage ?? null,
          niftyRow?.sniper_score ?? null,
          advances,
          declines,
          unchangedCount,
          adRatio,
          pctAbove50ma,
          pctAbove200ma,
          newHighs,
          newLows,
          upVolume,
          downVolume,
          pctUp2,
          pctDown2,
          pctAboveVwap,
          emaStackBullPct,
          pctAbove200ma,
          pctAbove50ma,
          macdBreadthPct,
          adxTrendingPct,
          avgRsi,
          pctOversold,
          pctOverbought,
          smartMoneyAcc,
          smartMoneyDist,
          0,
          0, // bull/bear divergence - not yet implemented
          bbSqueezeCount,
          0,
          0, // gap_ups, gap_downs - not yet implemented
          volSurgesCount,
          stage2Pct,
          stage4Pct,
          moodScore,
          indiaVix,
        );

      processed++;
    }

    return { processed };
  }

  computeSectorState(opts: { from?: string; to?: string } = {}): { processed: number } {
    const conditions: string[] = [];
    if (opts.from) conditions.push(`date >= '${opts.from}'`);
    if (opts.to) conditions.push(`date <= '${opts.to}'`);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const dates = (
      this.db
        .prepare(`SELECT DISTINCT date FROM indicators_daily ${whereClause} ORDER BY date ASC`)
        .all() as Array<{ date: string }>
    ).map((r) => r.date);

    const sectorIndexes = this.db
      .prepare(
        `SELECT symbol, name FROM instruments
         WHERE instrument_type = 'index' AND index_category = 'sector' AND is_active = 1`,
      )
      .all() as Array<{ symbol: string; name: string }>;

    if (sectorIndexes.length === 0) return { processed: 0 };

    const upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sector_state_daily (
        date, sector, sector_index_symbol,
        sector_return_1d, sector_return_1w, sector_return_1m,
        sector_return_3m, sector_return_6m, sector_return_ytd,
        rs_rank, rs_rank_prev_week, rs_rank_delta_1w,
        pct_members_uptrend, pct_members_stage2,
        advances, declines, avg_member_rs, avg_member_composite,
        top_stock_symbol, top_stock_return_1d, breadth_pct
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    let processed = 0;

    for (const date of dates) {
      type SectorEntry = {
        sector: string;
        index: string;
        return_1d: number | null;
        return_1w: number | null;
        return_1m: number | null;
        return_3m: number | null;
        return_6m: number | null;
        return_ytd: number | null;
        pct_members_uptrend: number | null;
        pct_members_stage2: number | null;
        advances: number;
        declines: number;
        avg_member_rs: number | null;
        avg_member_composite: number | null;
        top_stock_symbol: string | null;
        top_stock_return_1d: number | null;
        breadth_pct: number | null;
      };

      const entries: SectorEntry[] = [];

      for (const idx of sectorIndexes) {
        const idxInd = this.db
          .prepare(
            `SELECT return_1d, return_1w, return_1m, return_3m, return_6m, return_ytd
             FROM indicators_daily WHERE symbol = ? AND date = ?`,
          )
          .get(idx.symbol, date) as
          | {
              return_1d: number | null;
              return_1w: number | null;
              return_1m: number | null;
              return_3m: number | null;
              return_6m: number | null;
              return_ytd: number | null;
            }
          | undefined;

        const memberRows = this.db
          .prepare(
            `SELECT id.symbol, id.stage, id.return_1d, id.rs_vs_broad, id.composite_score,
                    o.close, id.ema_50
             FROM index_constituents ic
             JOIN indicators_daily id ON ic.member_symbol = id.symbol AND id.date = ?
             JOIN ohlcv_daily o ON ic.member_symbol = o.symbol AND o.date = ?
             WHERE ic.index_symbol = ?`,
          )
          .all(date, date, idx.symbol) as Array<{
          symbol: string;
          stage: number | null;
          return_1d: number | null;
          rs_vs_broad: number | null;
          composite_score: number | null;
          close: number;
          ema_50: number | null;
        }>;

        const totalMembers = memberRows.length;
        const advances = memberRows.filter((r) => (r.return_1d ?? 0) > 0).length;
        const declines = memberRows.filter((r) => (r.return_1d ?? 0) < 0).length;

        const pctMembersUptrend =
          totalMembers > 0
            ? (memberRows.filter((r) => r.ema_50 !== null && r.close > r.ema_50).length /
                totalMembers) *
              100
            : null;

        const pctMembersStage2 =
          totalMembers > 0
            ? (memberRows.filter((r) => r.stage === 2).length / totalMembers) * 100
            : null;

        const rsValues = memberRows
          .map((r) => r.rs_vs_broad)
          .filter((v): v is number => v !== null);
        const avgMemberRs =
          rsValues.length > 0 ? rsValues.reduce((s, v) => s + v, 0) / rsValues.length : null;

        const compositeValues = memberRows
          .map((r) => r.composite_score)
          .filter((v): v is number => v !== null);
        const avgMemberComposite =
          compositeValues.length > 0
            ? compositeValues.reduce((s, v) => s + v, 0) / compositeValues.length
            : null;

        const topStock = memberRows
          .filter((r) => r.composite_score !== null)
          .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0))[0];

        const breadthPct =
          advances + declines > 0 ? (advances / (advances + declines)) * 100 : null;

        entries.push({
          sector: idx.name,
          index: idx.symbol,
          return_1d: idxInd?.return_1d ?? null,
          return_1w: idxInd?.return_1w ?? null,
          return_1m: idxInd?.return_1m ?? null,
          return_3m: idxInd?.return_3m ?? null,
          return_6m: idxInd?.return_6m ?? null,
          return_ytd: idxInd?.return_ytd ?? null,
          pct_members_uptrend: pctMembersUptrend,
          pct_members_stage2: pctMembersStage2,
          advances,
          declines,
          avg_member_rs: avgMemberRs,
          avg_member_composite: avgMemberComposite,
          top_stock_symbol: topStock?.symbol ?? null,
          top_stock_return_1d: topStock?.return_1d ?? null,
          breadth_pct: breadthPct,
        });
      }

      // Cross-sectional rs_rank from return_1m percentile
      const validReturns = entries
        .map((e) => e.return_1m)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);

      function pctRank(sorted: number[], target: number): number {
        if (sorted.length === 0) return 50;
        return Math.round((sorted.filter((v) => v < target).length / sorted.length) * 100);
      }

      for (const e of entries) {
        const rsRank = e.return_1m !== null ? pctRank(validReturns, e.return_1m) : null;

        // rs_rank_prev_week: look up the last known row from before this date (up to 5 days back)
        const prevRows = this.db
          .prepare(
            `SELECT rs_rank FROM sector_state_daily WHERE sector = ? AND date < ? ORDER BY date DESC LIMIT 5`,
          )
          .all(e.sector, date) as Array<{ rs_rank: number | null }>;
        const rsRankPrevWeek =
          prevRows.length > 0 ? (prevRows[prevRows.length - 1]?.rs_rank ?? null) : null;
        const rsRankDelta =
          rsRank !== null && rsRankPrevWeek !== null ? rsRank - rsRankPrevWeek : null;

        upsertStmt.run(
          date,
          e.sector,
          e.index,
          e.return_1d,
          e.return_1w,
          e.return_1m,
          e.return_3m,
          e.return_6m,
          e.return_ytd,
          rsRank,
          rsRankPrevWeek,
          rsRankDelta,
          e.pct_members_uptrend,
          e.pct_members_stage2,
          e.advances,
          e.declines,
          e.avg_member_rs,
          e.avg_member_composite,
          e.top_stock_symbol,
          e.top_stock_return_1d,
          e.breadth_pct,
        );
      }

      processed++;
    }

    return { processed };
  }

  checkWatchdog(opts: {
    symbol: string;
    condition: string;
    cooldownDays?: number;
    date?: string;
  }): WatchdogResult {
    const cooldown = opts.cooldownDays ?? 3;
    // Normalize condition string as a compact hash key
    const conditionHash = opts.condition.replace(/\s+/g, ' ').trim().slice(0, 200);

    // Get the latest date for this symbol
    const dateRow = opts.date
      ? { d: opts.date }
      : (this.db
          .prepare('SELECT MAX(date) as d FROM indicators_daily WHERE symbol = ?')
          .get(opts.symbol) as { d: string | null });
    const evalDate = dateRow.d;
    if (!evalDate) {
      return { matched: false, suppressed: false, current_values: null, last_alerted_date: null };
    }

    // Get current indicator values
    const currentRow = this.db
      .prepare(
        `SELECT symbol, date, rvol, dist_52wk_high_pct, setup_type, sniper_score,
                stage, composite_score, rsi_14
         FROM indicators_daily WHERE symbol = ? AND date = ?`,
      )
      .get(opts.symbol, evalDate) as
      | {
          symbol: string;
          date: string;
          rvol: number | null;
          dist_52wk_high_pct: number | null;
          setup_type: string | null;
          sniper_score: number | null;
          stage: number | null;
          composite_score: number | null;
          rsi_14: number | null;
        }
      | undefined;

    if (!currentRow) {
      return { matched: false, suppressed: false, current_values: null, last_alerted_date: null };
    }

    // Evaluate condition
    let matched = false;
    try {
      const testRow = this.db
        .prepare(
          `SELECT 1 as hit FROM indicators_daily id
           WHERE id.symbol = ? AND id.date = ? AND (${opts.condition})`,
        )
        .get(opts.symbol, evalDate) as { hit: number } | undefined;
      matched = testRow !== undefined;
    } catch {
      // Invalid condition — treat as no match
      matched = false;
    }

    // Check cooldown
    const alertRow = this.db
      .prepare(
        'SELECT last_alerted, alert_count FROM watchlist_alerts WHERE symbol = ? AND condition_hash = ?',
      )
      .get(opts.symbol, conditionHash) as { last_alerted: string; alert_count: number } | undefined;

    const lastAlertedDate = alertRow?.last_alerted ?? null;

    if (matched) {
      // Check if within cooldown window
      if (lastAlertedDate) {
        const lastMs = new Date(lastAlertedDate).getTime();
        const evalMs = new Date(evalDate).getTime();
        const daysDiff = (evalMs - lastMs) / (1000 * 60 * 60 * 24);
        if (daysDiff < cooldown) {
          return {
            matched: true,
            suppressed: true,
            current_values: currentRow,
            last_alerted_date: lastAlertedDate,
          };
        }
      }

      // Fire alert — upsert cooldown record
      const newCount = (alertRow?.alert_count ?? 0) + 1;
      this.db
        .prepare(
          `INSERT OR REPLACE INTO watchlist_alerts (symbol, condition_hash, last_alerted, alert_count)
           VALUES (?, ?, ?, ?)`,
        )
        .run(opts.symbol, conditionHash, evalDate, newCount);

      return {
        matched: true,
        suppressed: false,
        current_values: currentRow,
        last_alerted_date: lastAlertedDate,
      };
    }

    return {
      matched: false,
      suppressed: false,
      current_values: currentRow,
      last_alerted_date: lastAlertedDate,
    };
  }

  runBacktest(opts: {
    screen?: string;
    scanId?: string;
    from: string;
    to: string;
    holdDays?: number;
    stopAtrMult?: number;
    benchmark?: string;
  }): BacktestResult {
    const holdDays = opts.holdDays ?? 10;
    const stopAtrMult = opts.stopAtrMult ?? 2.0;
    const benchmark = opts.benchmark ?? '^CRSLDX';

    // Resolve condition: scan takes precedence if both provided
    let condition = opts.screen ?? '';
    if (opts.scanId) {
      const scanRow = this.db
        .prepare('SELECT sql_template FROM saved_scans WHERE scan_id = ?')
        .get(opts.scanId) as { sql_template: string } | undefined;
      if (scanRow) condition = scanRow.sql_template;
    }
    if (!condition) {
      return {
        trades: [],
        summary: {
          total_trades: 0,
          win_rate: 0,
          avg_gain_wins: 0,
          avg_loss: 0,
          expectancy: 0,
          max_drawdown: 0,
          sharpe_approx: 0,
          benchmark_return: 0,
          screen_alpha: 0,
          avg_hold: 0,
        },
        by_regime: {},
      };
    }

    // Get all signal dates in range
    const signalDates = (
      this.db
        .prepare(
          `SELECT DISTINCT date FROM indicators_daily
         WHERE date >= ? AND date <= ? ORDER BY date ASC`,
        )
        .all(opts.from, opts.to) as Array<{ date: string }>
    ).map((r) => r.date);

    const trades: BacktestTrade[] = [];

    for (const signalDate of signalDates) {
      // Find stocks matching condition on this date
      let signalRows: Array<{
        symbol: string;
        atr_14: number | null;
        setup_type: string | null;
        sniper_score: number | null;
      }>;
      try {
        signalRows = this.db
          .prepare(
            `SELECT id.symbol, id.atr_14, id.setup_type, id.sniper_score
             FROM indicators_daily id
             JOIN instruments i ON id.symbol = i.symbol
             WHERE id.date = ? AND i.instrument_type = 'equity' AND i.is_active = 1
             AND (${condition})`,
          )
          .all(signalDate) as Array<{
          symbol: string;
          atr_14: number | null;
          setup_type: string | null;
          sniper_score: number | null;
        }>;
      } catch {
        continue; // Invalid condition
      }

      // Get Nifty stage at signal date
      const niftyRow = this.db
        .prepare(`SELECT stage FROM indicators_daily WHERE symbol = '^NSEI' AND date = ?`)
        .get(signalDate) as { stage: number | null } | undefined;
      const regimeStage = niftyRow?.stage ?? null;

      for (const sig of signalRows) {
        // Entry: next trading day's open
        const nextDay = this.db
          .prepare(
            `SELECT date, open FROM ohlcv_daily
             WHERE symbol = ? AND date > ? ORDER BY date ASC LIMIT 1`,
          )
          .get(sig.symbol, signalDate) as { date: string; open: number } | undefined;
        if (!nextDay || nextDay.open <= 0) continue;

        const entryDate = nextDay.date;
        const entryPrice = nextDay.open;

        // ATR-based stop
        const atr = sig.atr_14 ?? entryPrice * 0.03;
        const stopPrice = entryPrice - stopAtrMult * atr;

        // Walk forward up to holdDays trading days from entry (inclusive)
        const forwardRows = this.db
          .prepare(
            `SELECT date, open, high, low, close FROM ohlcv_daily
             WHERE symbol = ? AND date >= ? ORDER BY date ASC LIMIT ?`,
          )
          .all(sig.symbol, entryDate, holdDays + 1) as Array<{
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
        }>;

        if (forwardRows.length === 0) continue;

        let exitDate = '';
        let exitPrice = 0;
        let exitReason: 'stop' | 'time' = 'time';
        let holdingDays = 0;

        for (let i = 0; i < Math.min(holdDays, forwardRows.length); i++) {
          const row = forwardRows[i];
          if (!row) break;
          holdingDays = i + 1;

          if (row.low <= stopPrice) {
            // Stop triggered — exit at stop (or open if gap below stop)
            exitPrice = Math.max(Math.min(stopPrice, row.open), 0.01);
            exitDate = row.date;
            exitReason = 'stop';
            break;
          }

          if (i === Math.min(holdDays, forwardRows.length) - 1) {
            // Hold days reached
            exitPrice = row.close;
            exitDate = row.date;
            exitReason = 'time';
          }
        }

        if (!exitDate || exitPrice <= 0) continue;

        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

        trades.push({
          symbol: sig.symbol,
          signal_date: signalDate,
          entry_date: entryDate,
          entry_price: entryPrice,
          exit_date: exitDate,
          exit_price: exitPrice,
          exit_reason: exitReason,
          pnl_pct: pnlPct,
          holding_days: holdingDays,
          setup_type: sig.setup_type,
          sniper_score: sig.sniper_score,
          regime_stage: regimeStage,
        });
      }
    }

    // Build summary
    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return {
        trades: [],
        summary: {
          total_trades: 0,
          win_rate: 0,
          avg_gain_wins: 0,
          avg_loss: 0,
          expectancy: 0,
          max_drawdown: 0,
          sharpe_approx: 0,
          benchmark_return: 0,
          screen_alpha: 0,
          avg_hold: 0,
        },
        by_regime: {},
      };
    }

    const wins = trades.filter((t) => t.pnl_pct > 0);
    const losses = trades.filter((t) => t.pnl_pct <= 0);
    const winRate = wins.length / totalTrades;
    const avgGainWins = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl_pct, 0) / wins.length : 0;
    const avgLoss =
      losses.length > 0 ? losses.reduce((s, t) => s + t.pnl_pct, 0) / losses.length : 0;
    const expectancy = winRate * avgGainWins + (1 - winRate) * avgLoss;
    const avgHold = trades.reduce((s, t) => s + t.holding_days, 0) / totalTrades;

    // Max drawdown from equity curve
    const equity = [100];
    let peak = 100;
    let maxDrawdown = 0;
    for (const t of trades) {
      const newEq = (equity[equity.length - 1] ?? 100) * (1 + t.pnl_pct / 100);
      equity.push(newEq);
      if (newEq > peak) peak = newEq;
      const dd = ((newEq - peak) / peak) * 100;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    // Sharpe (simplified, trade-level)
    const meanPnl = trades.reduce((s, t) => s + t.pnl_pct, 0) / totalTrades;
    const stdPnl =
      totalTrades > 1
        ? Math.sqrt(trades.reduce((s, t) => s + (t.pnl_pct - meanPnl) ** 2, 0) / (totalTrades - 1))
        : 0;
    const sharpeApprox =
      stdPnl > 0 ? (meanPnl / stdPnl) * Math.sqrt(252 / Math.max(avgHold, 1)) : 0;

    // Benchmark return
    const benchmarkRows = this.db
      .prepare(`SELECT date, close FROM ohlcv_daily WHERE symbol = ? ORDER BY date ASC`)
      .all(benchmark) as Array<{ date: string; close: number }>;

    const benchFromRow = benchmarkRows.find((r) => r.date >= opts.from);
    const benchToRow = [...benchmarkRows].reverse().find((r) => r.date <= opts.to);
    const benchmarkReturn =
      benchFromRow && benchToRow && benchFromRow.close > 0
        ? ((benchToRow.close - benchFromRow.close) / benchFromRow.close) * 100
        : 0;

    // Screen total compounded return vs benchmark
    const finalEquity = equity[equity.length - 1] ?? 100;
    const screenTotalReturn = finalEquity - 100;
    const screenAlpha = screenTotalReturn - benchmarkReturn;

    // By-regime breakdown
    const byRegime: Record<string, { trades: number; win_rate: number; expectancy: number }> = {};
    const regimeGroups = new Map<string, BacktestTrade[]>();
    for (const t of trades) {
      const key = t.regime_stage !== null ? `stage_${t.regime_stage}` : 'unknown';
      if (!regimeGroups.has(key)) regimeGroups.set(key, []);
      regimeGroups.get(key)?.push(t);
    }
    for (const [key, group] of regimeGroups) {
      const gWins = group.filter((t) => t.pnl_pct > 0);
      const gLosses = group.filter((t) => t.pnl_pct <= 0);
      const gWinRate = gWins.length / group.length;
      const gAvgGain =
        gWins.length > 0 ? gWins.reduce((s, t) => s + t.pnl_pct, 0) / gWins.length : 0;
      const gAvgLoss =
        gLosses.length > 0 ? gLosses.reduce((s, t) => s + t.pnl_pct, 0) / gLosses.length : 0;
      byRegime[key] = {
        trades: group.length,
        win_rate: gWinRate,
        expectancy: gWinRate * gAvgGain + (1 - gWinRate) * gAvgLoss,
      };
    }

    return {
      trades,
      summary: {
        total_trades: totalTrades,
        win_rate: winRate,
        avg_gain_wins: avgGainWins,
        avg_loss: avgLoss,
        expectancy,
        max_drawdown: maxDrawdown,
        sharpe_approx: sharpeApprox,
        benchmark_return: benchmarkReturn,
        screen_alpha: screenAlpha,
        avg_hold: avgHold,
      },
      by_regime: byRegime,
    };
  }

  detectSplits(gapThreshold = 0.4): Array<{
    symbol: string;
    date: string;
    open: number;
    prevClose: number;
    gapPct: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT symbol, date, open,
                LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS prev_close
         FROM ohlcv_daily
         ORDER BY symbol, date`,
      )
      .all() as Array<{
      symbol: string;
      date: string;
      open: number;
      prev_close: number | null;
    }>;

    const result: Array<{
      symbol: string;
      date: string;
      open: number;
      prevClose: number;
      gapPct: number;
    }> = [];
    for (const r of rows) {
      if (r.prev_close === null || r.prev_close === 0) continue;
      const gapPct = Math.abs(r.open / r.prev_close - 1);
      if (gapPct > gapThreshold) {
        result.push({
          symbol: r.symbol,
          date: r.date,
          open: r.open,
          prevClose: r.prev_close,
          gapPct,
        });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // FII/DII Daily
  // ---------------------------------------------------------------------------

  upsertFiiDii(
    rows: Array<{
      date: string;
      fii_buy: number;
      fii_sell: number;
      fii_net: number;
      dii_buy: number;
      dii_sell: number;
      dii_net: number;
    }>,
  ): number {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO fii_dii_daily (date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    let count = 0;
    const insert = this.db.transaction(() => {
      for (const r of rows) {
        stmt.run(r.date, r.fii_buy, r.fii_sell, r.fii_net, r.dii_buy, r.dii_sell, r.dii_net);
        count++;
      }
    });
    insert();
    return count;
  }

  getFiiDii(opts: { date?: string; days?: number } = {}): FiiDiiDbRow[] {
    if (opts.days) {
      return this.db
        .prepare(
          `SELECT * FROM (
            SELECT * FROM fii_dii_daily ORDER BY date DESC LIMIT ?
          ) ORDER BY date ASC`,
        )
        .all(opts.days) as FiiDiiDbRow[];
    }
    if (opts.date) {
      return this.db
        .prepare('SELECT * FROM fii_dii_daily WHERE date = ?')
        .all(opts.date) as FiiDiiDbRow[];
    }
    // latest row
    const row = this.db.prepare('SELECT * FROM fii_dii_daily ORDER BY date DESC LIMIT 1').get() as
      | FiiDiiDbRow
      | undefined;
    return row ? [row] : [];
  }

  // ---------------------------------------------------------------------------
  // Corporate Actions
  // ---------------------------------------------------------------------------

  upsertCorporateActions(
    rows: Array<{ symbol: string; ex_date: string; purpose: string; value?: string | null }>,
  ): number {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO corporate_actions (symbol, ex_date, purpose, value)
       VALUES (?, ?, ?, ?)`,
    );
    let count = 0;
    const insert = this.db.transaction(() => {
      for (const r of rows) {
        stmt.run(r.symbol, r.ex_date, r.purpose, r.value ?? null);
        count++;
      }
    });
    insert();
    return count;
  }

  getCorporateActions(symbol: string, fromDate?: string, toDate?: string): CorporateActionDbRow[] {
    let sql = 'SELECT * FROM corporate_actions WHERE symbol = ?';
    const params: unknown[] = [symbol];
    if (fromDate) {
      sql += ' AND ex_date >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      sql += ' AND ex_date <= ?';
      params.push(toDate);
    }
    sql += ' ORDER BY ex_date DESC';
    return this.db.prepare(sql).all(...params) as CorporateActionDbRow[];
  }

  // ---------------------------------------------------------------------------
  // Bulk / Block Deals
  // ---------------------------------------------------------------------------

  upsertBulkBlockDeals(
    rows: Array<{
      date: string;
      symbol: string;
      client_name: string;
      deal_type: string;
      trade_type: string;
      quantity: number;
      price: number;
    }>,
  ): number {
    const stmt = this.db.prepare(
      `INSERT INTO bulk_block_deals (date, symbol, client_name, deal_type, trade_type, quantity, price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    let count = 0;
    const insert = this.db.transaction(() => {
      for (const r of rows) {
        stmt.run(r.date, r.symbol, r.client_name, r.deal_type, r.trade_type, r.quantity, r.price);
        count++;
      }
    });
    insert();
    return count;
  }

  getBulkBlockDeals(opts: { date?: string; symbol?: string } = {}): BulkBlockDealDbRow[] {
    if (!opts.date && !opts.symbol) {
      // Return latest date's deals
      const latest = this.db.prepare('SELECT MAX(date) as d FROM bulk_block_deals').get() as {
        d: string | null;
      };
      if (!latest.d) return [];
      return this.db
        .prepare('SELECT * FROM bulk_block_deals WHERE date = ? ORDER BY id ASC')
        .all(latest.d) as BulkBlockDealDbRow[];
    }
    let sql = 'SELECT * FROM bulk_block_deals WHERE 1=1';
    const params: unknown[] = [];
    if (opts.date) {
      sql += ' AND date = ?';
      params.push(opts.date);
    }
    if (opts.symbol) {
      sql += ' AND symbol = ?';
      params.push(opts.symbol);
    }
    sql += ' ORDER BY id ASC';
    return this.db.prepare(sql).all(...params) as BulkBlockDealDbRow[];
  }
}
