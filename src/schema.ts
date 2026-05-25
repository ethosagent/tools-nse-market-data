import type Database from 'better-sqlite3';

export const SQL_CREATE_INSTRUMENTS = `
  CREATE TABLE IF NOT EXISTS instruments (
    symbol    TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    exchange  TEXT NOT NULL DEFAULT 'NSE',
    sector    TEXT,
    isin      TEXT,
    added_at  INTEGER NOT NULL
  ) STRICT;
`;

export const SQL_CREATE_OHLCV_DAILY = `
  CREATE TABLE IF NOT EXISTS ohlcv_daily (
    symbol    TEXT NOT NULL,
    date      TEXT NOT NULL,
    open      REAL NOT NULL,
    high      REAL NOT NULL,
    low       REAL NOT NULL,
    close     REAL NOT NULL,
    volume    INTEGER NOT NULL,
    adj_close REAL,
    PRIMARY KEY (symbol, date)
  ) STRICT;
`;

export const SQL_CREATE_OHLCV_DATE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_ohlcv_date ON ohlcv_daily(date);
`;

export const SQL_CREATE_SYNC_META = `
  CREATE TABLE IF NOT EXISTS sync_meta (
    symbol    TEXT PRIMARY KEY,
    last_sync INTEGER NOT NULL,
    last_date TEXT NOT NULL
  ) STRICT;
`;

export const SQL_CREATE_WATCHLIST = `
  CREATE TABLE IF NOT EXISTS watchlist (
    symbol    TEXT NOT NULL,
    list_name TEXT NOT NULL DEFAULT 'default',
    notes     TEXT,
    added_at  INTEGER NOT NULL,
    PRIMARY KEY (symbol, list_name)
  ) STRICT;
`;

export const SQL_CREATE_INDEX_CONSTITUENTS = `
  CREATE TABLE IF NOT EXISTS index_constituents (
    index_symbol  TEXT NOT NULL,
    member_symbol TEXT NOT NULL,
    weight        REAL,
    as_of_date    TEXT NOT NULL,
    PRIMARY KEY (index_symbol, member_symbol)
  ) STRICT;
`;

export const SQL_CREATE_ATH_TRACKER = `
  CREATE TABLE IF NOT EXISTS ath_tracker (
    symbol     TEXT PRIMARY KEY,
    ath_price  REAL NOT NULL,
    ath_date   TEXT NOT NULL
  ) STRICT;
`;

export const SQL_CREATE_SAVED_SCANS = `
  CREATE TABLE IF NOT EXISTS saved_scans (
    scan_id       TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,
    description   TEXT,
    sql_template  TEXT NOT NULL,
    tags          TEXT,
    is_builtin    INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (date('now'))
  ) STRICT;
`;

export const SQL_CREATE_INDICATORS_DAILY = `
  CREATE TABLE IF NOT EXISTS indicators_daily (
    symbol              TEXT NOT NULL,
    date                TEXT NOT NULL,

    -- Trend / Moving Averages
    ema_20              REAL,
    ema_50              REAL,
    ema_100             REAL,
    ema_200             REAL,
    sma_50              REAL,
    sma_200             REAL,
    ma_stack            INTEGER,
    ema_50_slope        REAL,

    -- Momentum
    rsi_14              REAL,
    macd                REAL,
    macd_signal         REAL,
    macd_hist           REAL,
    macd_hist_prev      REAL,
    adx                 REAL,
    adx_di_plus         REAL,
    adx_di_minus        REAL,
    stoch_k             REAL,
    stoch_d             REAL,
    cci_20              REAL,
    williams_r          REAL,
    psar                REAL,
    psar_signal         INTEGER,
    psar_signal_prev    INTEGER,
    roc_5               REAL,
    return_1d           REAL,
    return_1w           REAL,
    return_1m           REAL,
    return_3m           REAL,
    return_6m           REAL,
    return_1y           REAL,
    return_ytd          REAL,

    -- Relative Strength
    rs_vs_segment       REAL,
    rs_vs_broad         REAL,
    rs_rank_in_segment  REAL,
    rs_rank_in_sector   REAL,

    -- Volatility / Range
    atr_14              REAL,
    adr_pct             REAL,
    bb_upper            REAL,
    bb_lower            REAL,
    bb_middle           REAL,
    bb_width            REAL,
    keltner_upper       REAL,
    keltner_lower       REAL,
    donchian_upper_20   REAL,
    donchian_lower_20   REAL,

    -- Volume
    rvol                REAL,
    vol_sma_20          REAL,
    avg_dollar_volume_20 REAL,
    delivery_pct        REAL,
    delivery_ma_20      REAL,
    obv                 REAL,
    obv_slope_5d        REAL,
    close_position_ratio REAL,

    -- VWAP
    vwap                REAL,
    closed_above_vwap   INTEGER,

    -- Price Levels / Location
    dist_52wk_high_pct  REAL,
    dist_52wk_low_pct   REAL,
    dist_ath_pct        REAL,
    pct_from_ema20      REAL,
    pct_from_ema50      REAL,
    pct_from_ema200     REAL,
    price_percentile_52w REAL,

    -- Candle Patterns
    candle_pattern      TEXT,

    -- Multi-Timeframe
    ema_20_weekly       REAL,
    ema_50_weekly       REAL,
    close_vs_ema20w     INTEGER,
    close_vs_ema50w     INTEGER,
    rsi_14_weekly       REAL,
    macd_hist_weekly    REAL,
    ema_10_monthly      REAL,
    close_vs_ema10m     INTEGER,
    tf_alignment_score  INTEGER,

    -- Stage Analysis
    stage               INTEGER,

    -- Sniper Score
    sniper_score        REAL,
    sniper_verdict      TEXT,

    -- Composite Score
    composite_score     INTEGER,
    composite_grade     TEXT,

    -- Setup Classification
    setup_type          TEXT,
    setup_quality       INTEGER,

    PRIMARY KEY (symbol, date)
  ) STRICT;
`;

export const SQL_CREATE_MARKET_STATE_DAILY = `
  CREATE TABLE IF NOT EXISTS market_state_daily (
    date TEXT PRIMARY KEY
  ) STRICT;
`;

export const SQL_CREATE_SECTOR_STATE_DAILY = `
  CREATE TABLE IF NOT EXISTS sector_state_daily (
    date   TEXT NOT NULL,
    sector TEXT NOT NULL,
    PRIMARY KEY (date, sector)
  ) STRICT;
`;

export const SQL_CREATE_SCHEMA_VERSION = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL,
    description TEXT
  ) STRICT;
`;

export const SQL_CREATE_WATCHLIST_ALERTS = `
  CREATE TABLE IF NOT EXISTS watchlist_alerts (
    symbol          TEXT NOT NULL,
    condition_hash  TEXT NOT NULL,
    last_alerted    TEXT NOT NULL,
    alert_count     INTEGER DEFAULT 1,
    PRIMARY KEY (symbol, condition_hash)
  ) STRICT;
`;

export const SQL_CREATE_FII_DII_DAILY = `
  CREATE TABLE IF NOT EXISTS fii_dii_daily (
    date      TEXT PRIMARY KEY,
    fii_buy   REAL NOT NULL,
    fii_sell  REAL NOT NULL,
    fii_net   REAL NOT NULL,
    dii_buy   REAL NOT NULL,
    dii_sell  REAL NOT NULL,
    dii_net   REAL NOT NULL
  ) STRICT;
`;

export const SQL_CREATE_CORPORATE_ACTIONS = `
  CREATE TABLE IF NOT EXISTS corporate_actions (
    symbol   TEXT NOT NULL,
    ex_date  TEXT NOT NULL,
    purpose  TEXT NOT NULL,
    value    TEXT,
    PRIMARY KEY (symbol, ex_date, purpose)
  ) STRICT;
`;

export const SQL_CREATE_BULK_BLOCK_DEALS = `
  CREATE TABLE IF NOT EXISTS bulk_block_deals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    client_name TEXT NOT NULL,
    deal_type   TEXT NOT NULL,
    trade_type  TEXT NOT NULL,
    quantity    INTEGER NOT NULL,
    price       REAL NOT NULL
  ) STRICT;
`;

export const SQL_CREATE_BULK_BLOCK_DEALS_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_bbd_date   ON bulk_block_deals (date);
  CREATE INDEX IF NOT EXISTS idx_bbd_symbol ON bulk_block_deals (symbol);
`;

function addColumnIfNotExists(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
  }
}

export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SQL_CREATE_INSTRUMENTS);
  db.exec(SQL_CREATE_OHLCV_DAILY);
  db.exec(SQL_CREATE_OHLCV_DATE_INDEX);
  db.exec(SQL_CREATE_SYNC_META);
  db.exec(SQL_CREATE_WATCHLIST);
  db.exec(SQL_CREATE_INDEX_CONSTITUENTS);
  db.exec(SQL_CREATE_ATH_TRACKER);
  db.exec(SQL_CREATE_SAVED_SCANS);
  db.exec(SQL_CREATE_INDICATORS_DAILY);

  // indicators_daily columns (Phase 2) — for existing DBs that have the stub table
  const indicatorsCols: Array<[string, string]> = [
    // Trend / Moving Averages
    ['ema_20', 'REAL'],
    ['ema_50', 'REAL'],
    ['ema_100', 'REAL'],
    ['ema_200', 'REAL'],
    ['sma_50', 'REAL'],
    ['sma_200', 'REAL'],
    ['ma_stack', 'INTEGER'],
    ['ema_50_slope', 'REAL'],
    // Momentum
    ['rsi_14', 'REAL'],
    ['macd', 'REAL'],
    ['macd_signal', 'REAL'],
    ['macd_hist', 'REAL'],
    ['macd_hist_prev', 'REAL'],
    ['adx', 'REAL'],
    ['adx_di_plus', 'REAL'],
    ['adx_di_minus', 'REAL'],
    ['stoch_k', 'REAL'],
    ['stoch_d', 'REAL'],
    ['cci_20', 'REAL'],
    ['williams_r', 'REAL'],
    ['psar', 'REAL'],
    ['psar_signal', 'INTEGER'],
    ['psar_signal_prev', 'INTEGER'],
    ['roc_5', 'REAL'],
    ['return_1d', 'REAL'],
    ['return_1w', 'REAL'],
    ['return_1m', 'REAL'],
    ['return_3m', 'REAL'],
    ['return_6m', 'REAL'],
    ['return_1y', 'REAL'],
    ['return_ytd', 'REAL'],
    // Relative Strength
    ['rs_vs_segment', 'REAL'],
    ['rs_vs_broad', 'REAL'],
    ['rs_rank_in_segment', 'REAL'],
    ['rs_rank_in_sector', 'REAL'],
    // Volatility / Range
    ['atr_14', 'REAL'],
    ['adr_pct', 'REAL'],
    ['bb_upper', 'REAL'],
    ['bb_lower', 'REAL'],
    ['bb_middle', 'REAL'],
    ['bb_width', 'REAL'],
    ['keltner_upper', 'REAL'],
    ['keltner_lower', 'REAL'],
    ['donchian_upper_20', 'REAL'],
    ['donchian_lower_20', 'REAL'],
    // Volume
    ['rvol', 'REAL'],
    ['vol_sma_20', 'REAL'],
    ['avg_dollar_volume_20', 'REAL'],
    ['delivery_pct', 'REAL'],
    ['delivery_ma_20', 'REAL'],
    ['obv', 'REAL'],
    ['obv_slope_5d', 'REAL'],
    ['close_position_ratio', 'REAL'],
    // VWAP
    ['vwap', 'REAL'],
    ['closed_above_vwap', 'INTEGER'],
    // Price Levels / Location
    ['dist_52wk_high_pct', 'REAL'],
    ['dist_52wk_low_pct', 'REAL'],
    ['dist_ath_pct', 'REAL'],
    ['pct_from_ema20', 'REAL'],
    ['pct_from_ema50', 'REAL'],
    ['pct_from_ema200', 'REAL'],
    ['price_percentile_52w', 'REAL'],
    // Candle Patterns
    ['candle_pattern', 'TEXT'],
    // Multi-Timeframe
    ['ema_20_weekly', 'REAL'],
    ['ema_50_weekly', 'REAL'],
    ['close_vs_ema20w', 'INTEGER'],
    ['close_vs_ema50w', 'INTEGER'],
    ['rsi_14_weekly', 'REAL'],
    ['macd_hist_weekly', 'REAL'],
    ['ema_10_monthly', 'REAL'],
    ['close_vs_ema10m', 'INTEGER'],
    ['tf_alignment_score', 'INTEGER'],
    // Stage Analysis
    ['stage', 'INTEGER'],
    // Sniper Score
    ['sniper_score', 'REAL'],
    ['sniper_verdict', 'TEXT'],
    // Composite Score
    ['composite_score', 'INTEGER'],
    ['composite_grade', 'TEXT'],
    // Setup Classification
    ['setup_type', 'TEXT'],
    ['setup_quality', 'INTEGER'],
  ];
  for (const [col, def] of indicatorsCols) {
    addColumnIfNotExists(db, 'indicators_daily', col, def);
  }

  db.exec(SQL_CREATE_MARKET_STATE_DAILY);

  // market_state_daily columns (Phase 4)
  const marketStateCols: Array<[string, string]> = [
    // Index reference
    ['nifty_close', 'REAL'],
    ['nifty_vs_ema50', 'INTEGER'],
    ['nifty_vs_ema200', 'INTEGER'],
    ['nifty_ema50_slope', 'REAL'],
    ['nifty_stage', 'INTEGER'],
    ['nifty_sniper_score', 'REAL'],
    // Classic breadth
    ['advances', 'INTEGER'],
    ['declines', 'INTEGER'],
    ['unchanged_count', 'INTEGER'],
    ['ad_ratio', 'REAL'],
    ['pct_above_50ma', 'REAL'],
    ['pct_above_200ma', 'REAL'],
    ['new_highs', 'INTEGER'],
    ['new_lows', 'INTEGER'],
    ['up_volume', 'INTEGER'],
    ['down_volume', 'INTEGER'],
    ['pct_up_2', 'REAL'],
    ['pct_down_2', 'REAL'],
    // VWAP breadth
    ['pct_above_vwap', 'REAL'],
    // Sniper Intelligence breadth
    ['ema_stack_bull_pct', 'REAL'],
    ['ema200_breadth_pct', 'REAL'],
    ['ema50_breadth_pct', 'REAL'],
    ['macd_breadth_pct', 'REAL'],
    ['adx_trending_pct', 'REAL'],
    ['avg_rsi', 'REAL'],
    ['pct_oversold', 'REAL'],
    ['pct_overbought', 'REAL'],
    ['smart_money_acc_count', 'INTEGER'],
    ['smart_money_dist_count', 'INTEGER'],
    ['bull_divergence_count', 'INTEGER'],
    ['bear_divergence_count', 'INTEGER'],
    ['bb_squeeze_count', 'INTEGER'],
    ['gap_ups_count', 'INTEGER'],
    ['gap_downs_count', 'INTEGER'],
    ['vol_surges_count', 'INTEGER'],
    ['stage2_pct', 'REAL'],
    ['stage4_pct', 'REAL'],
    ['mood_score', 'INTEGER'],
    ['india_vix', 'REAL'],
  ];
  for (const [col, def] of marketStateCols) {
    addColumnIfNotExists(db, 'market_state_daily', col, def);
  }

  db.exec(SQL_CREATE_SECTOR_STATE_DAILY);

  // sector_state_daily columns (Phase 5)
  const sectorStateCols: Array<[string, string]> = [
    ['sector_index_symbol', 'TEXT'],
    ['sector_return_1d', 'REAL'],
    ['sector_return_1w', 'REAL'],
    ['sector_return_1m', 'REAL'],
    ['sector_return_3m', 'REAL'],
    ['sector_return_6m', 'REAL'],
    ['sector_return_ytd', 'REAL'],
    ['rs_rank', 'REAL'],
    ['rs_rank_prev_week', 'REAL'],
    ['rs_rank_delta_1w', 'REAL'],
    ['pct_members_uptrend', 'REAL'],
    ['pct_members_stage2', 'REAL'],
    ['advances', 'INTEGER'],
    ['declines', 'INTEGER'],
    ['avg_member_rs', 'REAL'],
    ['avg_member_composite', 'REAL'],
    ['top_stock_symbol', 'TEXT'],
    ['top_stock_return_1d', 'REAL'],
    ['breadth_pct', 'REAL'],
  ];
  for (const [col, def] of sectorStateCols) {
    addColumnIfNotExists(db, 'sector_state_daily', col, def);
  }

  db.exec(SQL_CREATE_SCHEMA_VERSION);
  db.exec(SQL_CREATE_WATCHLIST_ALERTS);
  db.exec(SQL_CREATE_FII_DII_DAILY);
  db.exec(SQL_CREATE_CORPORATE_ACTIONS);
  db.exec(SQL_CREATE_BULK_BLOCK_DEALS);
  db.exec(SQL_CREATE_BULK_BLOCK_DEALS_INDEXES);

  // New columns on instruments
  addColumnIfNotExists(db, 'instruments', 'industry', 'TEXT');
  addColumnIfNotExists(db, 'instruments', 'market_cap_band', 'TEXT');
  addColumnIfNotExists(db, 'instruments', 'instrument_type', "TEXT NOT NULL DEFAULT 'equity'");
  addColumnIfNotExists(db, 'instruments', 'index_category', 'TEXT');
  addColumnIfNotExists(db, 'instruments', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfNotExists(db, 'instruments', 'as_of_date', 'TEXT');

  // New columns on ohlcv_daily
  addColumnIfNotExists(db, 'ohlcv_daily', 'adj_factor', 'REAL');
  addColumnIfNotExists(db, 'ohlcv_daily', 'delivery_qty', 'INTEGER');
  addColumnIfNotExists(db, 'ohlcv_daily', 'delivery_pct', 'REAL');
}

export interface InstrumentSeedRow {
  symbol: string;
  name: string;
  exchange?: string;
  sector?: string | null;
  industry?: string | null;
  isin?: string | null;
  market_cap_band?: string | null;
  instrument_type?: string;
  index_category?: string | null;
  is_active?: number;
  as_of_date?: string | null;
}

export interface IndexConstituentSeedRow {
  index_symbol: string;
  member_symbol: string;
  weight?: number | null;
  as_of_date: string;
}

export interface SavedScanRow {
  scan_id: string;
  name: string;
  category: string;
  description?: string | null;
  sql_template: string;
  tags?: string[] | null;
  is_builtin?: number;
}

export interface FiiDiiDbRow {
  date: string;
  fii_buy: number;
  fii_sell: number;
  fii_net: number;
  dii_buy: number;
  dii_sell: number;
  dii_net: number;
}

export interface CorporateActionDbRow {
  symbol: string;
  ex_date: string;
  purpose: string;
  value: string | null;
}

export interface BulkBlockDealDbRow {
  id: number;
  date: string;
  symbol: string;
  client_name: string;
  deal_type: string;
  trade_type: string;
  quantity: number;
  price: number;
}
