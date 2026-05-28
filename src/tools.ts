// Ethos Tool wrappers around MarketDataStore
// Implemented per Section 14 of tools-nse-market-data.md

import { readdirSync, readFileSync } from 'node:fs';

import type { EthosPlugin, EthosPluginApi } from '@ethosagent/plugin-sdk';
import type { Tool, ToolResult } from '@ethosagent/types';

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------

import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstrumentSeedRow, SavedScanRow } from './schema';
import { MarketDataStore } from './store';

function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return join(dirname(__filename), '..');
}

let _store: MarketDataStore | null = null;

function getStore(): MarketDataStore {
  if (!_store) {
    const dbPath =
      process.env.NSE_MARKET_DATA_DB ?? join(homedir(), '.ethos', 'market-data', 'market.db');
    _store = new MarketDataStore(dbPath);
  }
  return _store;
}

// ---------------------------------------------------------------------------
// Per-tool arg interfaces
// ---------------------------------------------------------------------------

interface BackfillArgs {
  symbols?: string;
  from_date?: string;
  days?: number;
}

interface UpdateArgs {
  mode?: 'watchlist' | 'all';
}

interface WatchlistAddArgs {
  symbol: string;
  list_name?: string;
  notes?: string;
}

interface WatchlistRemoveArgs {
  symbol: string;
  list_name?: string;
}

interface WatchlistShowArgs {
  list_name?: string;
}

interface HistoryArgs {
  symbol: string;
  days?: number;
}

interface ScreenArgs {
  list_name?: string;
  min_volume_surge?: number;
  near_high_pct?: number;
}

interface RunScanArgs {
  scan_id: string;
  date?: string;
  universe?: 'watchlist' | 'nifty50' | 'nifty500' | 'all';
  limit?: number;
}

interface InvokeSkillArgs {
  skill_id: string;
  params?: Record<string, unknown>;
}

interface MarketBriefArgs {
  date?: string;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const nseMarketCleanTool: Tool = {
  name: 'nse_market_clean',
  description:
    'Delete all market data from the local SQLite database. Use before a fresh backfill.',
  toolset: 'market',
  capabilities: {},
  requiresApproval: true,
  schema: { type: 'object', properties: {} },
  async execute(_args, _ctx): Promise<ToolResult> {
    const result = getStore().clean();
    return {
      ok: true,
      value: `Cleaned database: ${result.rowsDeleted.ohlcv} OHLCV rows, ${result.rowsDeleted.syncMeta} sync records, ${result.rowsDeleted.watchlist} watchlist entries deleted.`,
    };
  },
};

const nseMarketBackfillTool: Tool<BackfillArgs> = {
  name: 'nse_market_backfill',
  description:
    'Download daily OHLCV history for NSE stocks and store locally. Defaults to all ~510 instruments and 365 days. Pass days: 1825 for 5 years. One-time operation. Shows progress.',
  toolset: 'market',
  maxResultChars: 5000,
  requiresApproval: true,
  capabilities: {
    network: { allowedHosts: ['query1.finance.yahoo.com'] },
  },
  schema: {
    type: 'object',
    properties: {
      symbols: {
        type: 'string',
        description:
          'Comma-separated NSE symbols (e.g. RELIANCE.NS,TCS.NS). Omit to backfill all instruments.',
      },
      days: {
        type: 'number',
        description: 'Number of calendar days to backfill (e.g. 365, 1825). Defaults to 365.',
      },
      from_date: {
        type: 'string',
        description: 'Start date YYYY-MM-DD. Overrides days if both provided.',
      },
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const store = getStore();
    const daysBack = args.days ?? 365;
    const fromDate =
      args.from_date ??
      new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let symbols: string[];
    if (args.symbols) {
      symbols = args.symbols
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      symbols = store.listInstrumentSymbols();
      if (symbols.length === 0) {
        // Auto-seed instruments from bundled data/instruments.json
        const pkgRoot = getPackageRoot();
        const instruments = JSON.parse(
          readFileSync(join(pkgRoot, 'data', 'instruments.json'), 'utf-8'),
        ) as InstrumentSeedRow[];
        store.upsertInstruments(instruments);
        symbols = store.listInstrumentSymbols();
      }
      if (symbols.length === 0) {
        return {
          ok: false,
          error: 'Could not load instruments from data/instruments.json.',
          code: 'not_available',
        };
      }
    }

    const results: string[] = [];
    let totalRows = 0;
    let done = 0;

    for (const symbol of symbols) {
      ctx.emit?.({
        type: 'progress',
        toolName: 'nse_market_backfill',
        message: `Backfilling ${symbol} (${done + 1}/${symbols.length})...`,
        audience: 'user',
        percent: Math.round((done / symbols.length) * 100),
      });
      try {
        const result = await store.backfillSymbol(symbol, fromDate);
        results.push(`${symbol}: ${result.rowsInserted} rows`);
        totalRows += result.rowsInserted;
      } catch (err) {
        results.push(`${symbol}: ERROR — ${(err as Error).message}`);
      }
      done++;
    }

    return {
      ok: true,
      value: `${results.join('\n')}\n\nTotal: ${symbols.length} symbols, ${totalRows} rows inserted.`,
    };
  },
};

const nseMarketUpdateTool: Tool<UpdateArgs> = {
  name: 'nse_market_update',
  description:
    'Fetch missing trading days for tracked symbols. Checks last sync date and fills the gap to today.',
  toolset: 'market',
  capabilities: {
    network: { allowedHosts: ['query1.finance.yahoo.com'] },
  },
  schema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['watchlist', 'all'],
        description: 'Update watchlist symbols only (default) or all instruments.',
      },
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const store = getStore();
    const mode = args.mode ?? 'watchlist';

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_market_update',
      message: `Updating ${mode === 'all' ? 'all' : 'watchlist'} symbols...`,
      audience: 'user',
    });

    const results = mode === 'all' ? await store.updateAll() : await store.updateWatchlist();
    const totalRows = results.reduce((sum, r) => sum + r.rowsInserted, 0);
    const summary = results.map((r) => `${r.symbol}: +${r.rowsInserted} rows`).join('\n');

    return {
      ok: true,
      value: `${summary}\n\nTotal: ${results.length} symbols updated, ${totalRows} new rows.`,
    };
  },
};

const nseWatchlistAddTool: Tool<WatchlistAddArgs> = {
  name: 'nse_watchlist_add',
  description: 'Add a stock to your watchlist.',
  toolset: 'market',
  capabilities: {},
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'NSE symbol (e.g. RELIANCE.NS)' },
      list_name: { type: 'string', description: 'Watchlist name (default: "default")' },
      notes: {
        type: 'string',
        description: 'Optional notes about why you are watching this stock',
      },
    },
    required: ['symbol'],
  },
  async execute(args, _ctx): Promise<ToolResult> {
    getStore().watchlistAdd(args.symbol, args.list_name, args.notes);
    const list = args.list_name ?? 'default';
    return { ok: true, value: `Added ${args.symbol} to watchlist '${list}'.` };
  },
};

const nseWatchlistRemoveTool: Tool<WatchlistRemoveArgs> = {
  name: 'nse_watchlist_remove',
  description: 'Remove a stock from your watchlist.',
  toolset: 'market',
  capabilities: {},
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'NSE symbol to remove' },
      list_name: { type: 'string', description: 'Watchlist name (default: "default")' },
    },
    required: ['symbol'],
  },
  async execute(args, _ctx): Promise<ToolResult> {
    getStore().watchlistRemove(args.symbol, args.list_name);
    const list = args.list_name ?? 'default';
    return { ok: true, value: `Removed ${args.symbol} from watchlist '${list}'.` };
  },
};

const nseWatchlistShowTool: Tool<WatchlistShowArgs> = {
  name: 'nse_watchlist_show',
  description: 'Show your watchlist with last close price and metadata.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 5000,
  schema: {
    type: 'object',
    properties: {
      list_name: { type: 'string', description: 'Watchlist name (default: "default")' },
    },
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const store = getStore();
    const list = args.list_name ?? 'default';
    const entries = store.watchlistList(list);
    if (entries.length === 0) {
      return {
        ok: true,
        value: `Watchlist '${list}' is empty. Add symbols with nse_watchlist_add.`,
      };
    }

    const lines = [`Watchlist '${list}' (${entries.length} symbols):`, ''];
    for (const entry of entries) {
      const history = store.getHistory(entry.symbol, 1);
      const last = history[0];
      const price = last ? `close ${last.close} on ${last.date}` : 'no data';
      const notePart = entry.notes ? `  — ${entry.notes}` : '';
      lines.push(`  ${entry.symbol.padEnd(20)} ${price}${notePart}`);
    }
    return { ok: true, value: lines.join('\n') };
  },
};

const nseMarketHistoryTool: Tool<HistoryArgs> = {
  name: 'nse_market_history',
  description:
    'Get daily OHLCV history for a stock from local database. Used for technical analysis.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 30000,
  cache: { ttlMs: 300_000 },
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'NSE symbol (e.g. RELIANCE.NS)' },
      days: {
        type: 'number',
        description: 'Number of trading days to return (default 252, max 504)',
      },
    },
    required: ['symbol'],
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const days = Math.min(args.days ?? 252, 504);
    const rows = getStore().getHistory(args.symbol, days);
    if (rows.length === 0) {
      return {
        ok: false,
        error: `No data for ${args.symbol}. Run nse_market_backfill first.`,
        code: 'not_available',
      };
    }
    const header = 'Date        Open      High      Low       Close     Volume';
    const lines = rows.map(
      (r) =>
        `${r.date}  ${String(r.open).padStart(9)}  ${String(r.high).padStart(9)}  ${String(r.low).padStart(9)}  ${String(r.close).padStart(9)}  ${String(r.volume).padStart(10)}`,
    );
    return { ok: true, value: [header, ...lines].join('\n') };
  },
};

const nseMarketScreenTool: Tool<ScreenArgs> = {
  name: 'nse_market_screen',
  description: 'Scan stocks against technical criteria. Returns matches with key metrics.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 10000,
  cache: { ttlMs: 120_000 },
  schema: {
    type: 'object',
    properties: {
      list_name: { type: 'string', description: 'Watchlist to screen (default: "default")' },
      min_volume_surge: {
        type: 'number',
        description: 'Minimum volume/20d-avg ratio (e.g. 1.5 = 50% above average)',
      },
      near_high_pct: {
        type: 'number',
        description: 'Within N% of 52-week high (e.g. 5 = within 5%)',
      },
    },
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const rows = getStore().screen({
      listName: args.list_name,
      minVolumeSurge: args.min_volume_surge,
      nearHighPct: args.near_high_pct,
    });
    if (rows.length === 0) {
      return { ok: true, value: 'No symbols matched the screen criteria.' };
    }
    const header = 'Symbol               Close     VolSurge  From52wH%  52wH      52wL';
    const lines = rows.map(
      (r) =>
        `${r.symbol.padEnd(20)} ${String(r.close).padStart(9)} ${(`${r.volumeSurge.toFixed(1)}x`).padStart(9)} ${(`${r.pctFrom52wHigh.toFixed(1)}%`).padStart(10)} ${String(r.high52w).padStart(9)} ${String(r.low52w).padStart(9)}`,
    );
    return { ok: true, value: [header, ...lines].join('\n') };
  },
};

const nseRunScanTool: Tool<RunScanArgs> = {
  name: 'nse_run_scan',
  description:
    'Run a saved scan against the indicators database and return matching stocks. Requires compute-indicators to have been run first.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 20000,
  schema: {
    type: 'object',
    properties: {
      scan_id: {
        type: 'string',
        description: 'ID of the saved scan to run (e.g. stage2_momentum)',
      },
      date: {
        type: 'string',
        description: 'Date to query (YYYY-MM-DD). Defaults to latest indicators date.',
      },
      universe: {
        type: 'string',
        enum: ['watchlist', 'nifty50', 'nifty500', 'all'],
        description: 'Universe of stocks to scan (default: all)',
      },
      limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
    },
    required: ['scan_id'],
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const store = getStore();
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;

    // Look up the scan
    const scanRow = db
      .prepare('SELECT sql_template, name FROM saved_scans WHERE scan_id = ?')
      .get(args.scan_id) as { sql_template: string; name: string } | undefined;
    if (!scanRow) {
      return {
        ok: false,
        error: `Scan '${args.scan_id}' not found. Run nse_refresh_scans to load built-in scan definitions.`,
        code: 'not_available',
      };
    }

    // Determine query date
    const queryDate =
      args.date ??
      (() => {
        const row = db.prepare('SELECT MAX(date) as d FROM indicators_daily').get() as {
          d: string | null;
        };
        return row?.d ?? new Date().toISOString().slice(0, 10);
      })();

    const limit = args.limit ?? 50;
    const universe = args.universe ?? 'all';

    // Build universe clause
    let universeClause = '';
    if (universe === 'watchlist') {
      universeClause = 'AND EXISTS (SELECT 1 FROM watchlist w WHERE w.symbol = id.symbol)';
    } else if (universe === 'nifty50') {
      universeClause =
        "AND id.symbol IN (SELECT member_symbol FROM index_constituents WHERE index_symbol = '^NSEI')";
    } else if (universe === 'nifty500') {
      universeClause =
        "AND id.symbol IN (SELECT member_symbol FROM index_constituents WHERE index_symbol = '^CRSLDX')";
    }

    const sql = `
      SELECT id.symbol, i.name, i.sector, i.market_cap_band,
             id.close_position_ratio, id.composite_score, id.sniper_score,
             id.setup_type, id.stage, id.rvol, id.rsi_14, id.dist_52wk_high_pct,
             id.rs_rank_in_segment, id.return_1m, id.tf_alignment_score
      FROM indicators_daily id
      JOIN instruments i ON id.symbol = i.symbol
      LEFT JOIN ohlcv_daily o ON id.symbol = o.symbol AND id.date = o.date
      WHERE id.date = ? AND i.instrument_type = 'equity' AND i.is_active = 1
      AND (${scanRow.sql_template})
      ${universeClause}
      ORDER BY id.composite_score DESC
      LIMIT ?
    `;

    let rows: Array<{
      symbol: string;
      name: string | null;
      sector: string | null;
      market_cap_band: string | null;
      close_position_ratio: number | null;
      composite_score: number | null;
      sniper_score: number | null;
      setup_type: string | null;
      stage: number | null;
      rvol: number | null;
      rsi_14: number | null;
      dist_52wk_high_pct: number | null;
      rs_rank_in_segment: number | null;
      return_1m: number | null;
      tf_alignment_score: number | null;
    }>;

    try {
      rows = db.prepare(sql).all(queryDate, limit) as typeof rows;
    } catch (err) {
      return {
        ok: false,
        error: `Scan query failed: ${(err as Error).message}`,
        code: 'execution_failed',
      };
    }

    if (rows.length === 0) {
      return {
        ok: true,
        value: `No symbols matched scan '${args.scan_id}' on date ${queryDate}.`,
      };
    }

    const header =
      `Scan: ${scanRow.name} (${args.scan_id})  |  Date: ${queryDate}  |  Universe: ${universe}\n` +
      `${'Symbol'.padEnd(20)} ${'Name'.padEnd(25)} ${'Sector'.padEnd(18)} ${'Score'.padStart(5)} ${'Setup'.padEnd(25)} ${'RVOL'.padStart(6)} ${'RSI'.padStart(5)} ${'Dist52H%'.padStart(9)}`;
    const lines = rows.map((r) => {
      const sym = (r.symbol ?? '').padEnd(20);
      const nm = (r.name ?? '').slice(0, 24).padEnd(25);
      const sec = (r.sector ?? '').slice(0, 17).padEnd(18);
      const score = String(r.composite_score ?? '').padStart(5);
      const setup = (r.setup_type ?? '').slice(0, 24).padEnd(25);
      const rvol = r.rvol !== null ? `${r.rvol.toFixed(1)}x`.padStart(6) : '     -';
      const rsi = r.rsi_14 !== null ? r.rsi_14.toFixed(0).padStart(5) : '    -';
      const dist =
        r.dist_52wk_high_pct !== null
          ? `${r.dist_52wk_high_pct.toFixed(1)}%`.padStart(9)
          : '        -';
      return `${sym} ${nm} ${sec} ${score} ${setup} ${rvol} ${rsi} ${dist}`;
    });

    return { ok: true, value: [header, ...lines].join('\n') };
  },
};

const nseInvokeSkillTool: Tool<InvokeSkillArgs> = {
  name: 'nse_invoke_skill',
  description:
    'Load a named analysis skill with relevant market data context. The skill file contains a system prompt and output schema; data_context contains recent indicator data for the requested symbol or market.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 50000,
  schema: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description:
          'Skill name (e.g. stock_deep_analysis, trade_setup, market_regime, morning_brief)',
      },
      params: {
        type: 'object',
        description: 'Parameters for the skill (e.g. { symbol: "RELIANCE.NS" })',
      },
    },
    required: ['skill_id'],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const skillId = args.skill_id;
    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_invoke_skill',
      message: `Loading skill '${skillId}'...`,
      audience: 'internal',
    });
    const pkgRoot = getPackageRoot();

    // Load skill file
    let skillContent: string;
    try {
      skillContent = readFileSync(join(pkgRoot, 'skills', `${skillId}.md`), 'utf-8');
    } catch {
      return {
        ok: false,
        error: `Skill '${skillId}' not found. Available skills: stock_deep_analysis, trade_setup, stock_scoring, stage_analysis, market_regime, breadth_narrative, sector_rotation, morning_brief, scan_explain.`,
        code: 'not_available',
      };
    }

    const store = getStore();
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
    const symbol = args.params?.symbol as string | undefined;

    let dataContext: unknown = null;

    const symbolSkills = [
      'stock_deep_analysis',
      'trade_setup',
      'stock_scoring',
      'stage_analysis',
      'scan_explain',
    ];
    const marketSkills = ['market_regime', 'breadth_narrative'];
    const sectorSkills = ['sector_rotation'];
    const watchlistSkills = ['morning_brief'];

    if (symbolSkills.includes(skillId)) {
      if (!symbol) {
        return {
          ok: false,
          error: `Skill '${skillId}' requires a 'symbol' parameter.`,
          code: 'input_invalid',
        };
      }
      // Query last 90 days of indicators
      const rows = db
        .prepare(
          `SELECT * FROM indicators_daily WHERE symbol = ?
           ORDER BY date DESC LIMIT 90`,
        )
        .all(symbol);
      const history = store.getHistory(symbol, 90);
      dataContext = { symbol, indicators: rows, ohlcv: history };
    } else if (marketSkills.includes(skillId)) {
      const rows = db.prepare('SELECT * FROM market_state_daily ORDER BY date DESC LIMIT 20').all();
      dataContext = { market_state: rows };
    } else if (sectorSkills.includes(skillId)) {
      const rows = db.prepare('SELECT * FROM sector_state_daily ORDER BY date DESC LIMIT 28').all();
      dataContext = { sector_state: rows };
    } else if (watchlistSkills.includes(skillId)) {
      const latestDateRow = db.prepare('SELECT MAX(date) as d FROM indicators_daily').get() as {
        d: string | null;
      };
      const latestDate = latestDateRow?.d ?? new Date().toISOString().slice(0, 10);
      const rows = db
        .prepare(
          `SELECT id.*, i.name, i.sector, i.market_cap_band
           FROM indicators_daily id
           JOIN instruments i ON id.symbol = i.symbol
           JOIN watchlist w ON id.symbol = w.symbol
           WHERE id.date = ?
           ORDER BY id.composite_score DESC NULLS LAST
           LIMIT 10`,
        )
        .all(latestDate);
      dataContext = { date: latestDate, watchlist_indicators: rows };
    } else {
      dataContext = { note: 'No specific data context available for this skill.' };
    }

    const result = {
      skill_id: skillId,
      skill_content: skillContent,
      data_context: JSON.stringify(dataContext, null, 2),
      usage_hint:
        'Use skill_content as your system prompt, analyze the data_context, and produce output matching the Output Schema in the skill file.',
    };

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_invoke_skill',
      message: 'Skill data ready.',
      audience: 'internal',
      percent: 100,
    });

    return { ok: true, value: JSON.stringify(result, null, 2) };
  },
};

const nseMarketBriefTool: Tool<MarketBriefArgs> = {
  name: 'nse_market_brief',
  description:
    'Get complete structured market briefing — regime, sector rotation, top setups, scan density, and watchlist alerts. Returns JSON.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 15000,
  cache: { ttlMs: 300_000 },
  schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date YYYY-MM-DD (defaults to latest available)' },
    },
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const brief = getStore().getMarketBrief(args.date);
    return { ok: true, value: JSON.stringify(brief, null, 2) };
  },
};

interface IndicatorsArgs {
  symbol: string;
  days?: number;
}

const nseMarketIndicatorsTool: Tool<IndicatorsArgs> = {
  name: 'nse_market_indicators',
  description:
    'Get indicators_daily rows for a symbol over a date range. Returns EMA, RSI, MACD, ATR, stage, sniper score, setup type, and all computed metrics. Defaults to last 63 trading days.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 20000,
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'NSE symbol (e.g. RELIANCE.NS)' },
      days: {
        type: 'number',
        description: 'Number of recent trading days to return (default 63)',
      },
    },
    required: ['symbol'],
  },
  async execute(args, _ctx): Promise<ToolResult> {
    if (!args.symbol) {
      return { ok: false, error: 'symbol is required', code: 'input_invalid' };
    }
    const rows = getStore().getIndicators(args.symbol, args.days ?? 63);
    if (rows.length === 0) {
      return {
        ok: false,
        error: `No indicator data for ${args.symbol}. Run compute-indicators first.`,
        code: 'not_available',
      };
    }
    return { ok: true, value: JSON.stringify(rows, null, 2) };
  },
};

interface WatchdogArgs {
  symbol: string;
  condition: string;
  cooldown_days?: number;
  date?: string;
}

const nseWatchdogTool: Tool<WatchdogArgs> = {
  name: 'nse_watchdog',
  description:
    'Evaluate a condition against a symbol\'s latest indicators. Fires an alert if matched, respects a cooldown window. Condition is a SQL WHERE fragment using indicator columns (e.g. "rvol > 2 AND dist_52wk_high_pct < 3"). Returns match status, current values, and last alert date.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 3000,
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'NSE symbol (e.g. RELIANCE.NS)' },
      condition: {
        type: 'string',
        description:
          'SQL WHERE fragment using indicators_daily columns (e.g. "rvol > 2 AND setup_type = \'base_breakout\'")',
      },
      cooldown_days: {
        type: 'number',
        description: 'Suppress re-alerts within this many days (default 3)',
      },
      date: {
        type: 'string',
        description: 'Date YYYY-MM-DD to evaluate against (defaults to latest available)',
      },
    },
    required: ['symbol', 'condition'],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!args.symbol || !args.condition) {
      return { ok: false, error: 'symbol and condition are required', code: 'input_invalid' };
    }

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_watchdog',
      message: `Evaluating condition for ${args.symbol}...`,
      audience: 'internal',
    });

    const result = getStore().checkWatchdog({
      symbol: args.symbol,
      condition: args.condition,
      cooldownDays: args.cooldown_days,
      date: args.date,
    });

    return { ok: true, value: JSON.stringify(result, null, 2) };
  },
};

interface BacktestArgs {
  scan_id?: string;
  screen?: string;
  from: string;
  to: string;
  hold_days?: number;
  stop_atr_mult?: number;
  benchmark?: string;
}

interface ComputeIndicatorsArgs {
  symbol?: string;
  from?: string;
  to?: string;
}

const nseComputeIndicatorsTool: Tool<ComputeIndicatorsArgs> = {
  name: 'nse_compute_indicators',
  description:
    'Compute technical indicators from OHLCV data and store in indicators_daily. Run after nse_market_backfill or nse_market_update. With no arguments, processes all symbols for all available dates. Also recomputes market breadth and sector state.',
  toolset: 'market',
  maxResultChars: 2000,
  capabilities: {},
  schema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Single symbol to compute (e.g. RELIANCE.NS). Omit to process all.',
      },
      from: {
        type: 'string',
        description: 'Start date YYYY-MM-DD. Omit to process all available dates.',
      },
      to: {
        type: 'string',
        description: 'End date YYYY-MM-DD. Defaults to today.',
      },
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const store = getStore();

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_compute_indicators',
      message: 'Computing technical indicators…',
      audience: 'user',
      percent: 0,
    });

    const result = await store.computeIndicators({
      symbol: args.symbol,
      from: args.from,
      to: args.to,
    });

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_compute_indicators',
      message: 'Computing market breadth…',
      audience: 'user',
      percent: 80,
    });

    const marketResult = store.computeMarketState({ from: args.from, to: args.to });

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_compute_indicators',
      message: 'Computing sector state…',
      audience: 'user',
      percent: 90,
    });

    const sectorResult = store.computeSectorState({ from: args.from, to: args.to });

    return {
      ok: true,
      value: `Indicators: ${result.processed} symbols, ${result.dateCount} dates computed.\nMarket state: ${marketResult.processed} dates.\nSector state: ${sectorResult.processed} dates.\n\nData is ready for scans, screening, and analysis.`,
    };
  },
};

const nseBacktestTool: Tool<BacktestArgs> = {
  name: 'nse_backtest',
  description:
    'Replay a screen condition historically. Returns trade list + summary statistics including win rate, Sharpe, drawdown, benchmark return, and regime-sliced analysis. Requires indicators_daily to be computed first.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 20000,
  schema: {
    type: 'object',
    properties: {
      scan_id: {
        type: 'string',
        description: 'ID of a saved scan to replay (from saved_scans table)',
      },
      screen: {
        type: 'string',
        description:
          'SQL WHERE fragment using indicators_daily columns (e.g. "setup_type = \'base_breakout\' AND rvol > 1.5")',
      },
      from: { type: 'string', description: 'Start date YYYY-MM-DD' },
      to: { type: 'string', description: 'End date YYYY-MM-DD' },
      hold_days: { type: 'number', description: 'Max holding days (default 10)' },
      stop_atr_mult: {
        type: 'number',
        description: 'ATR multiplier for stop-loss (default 2.0)',
      },
      benchmark: {
        type: 'string',
        description: 'Benchmark symbol (default ^CRSLDX = Nifty 500)',
      },
    },
    required: ['from', 'to'],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!args.from || !args.to) {
      return { ok: false, error: 'from and to dates are required', code: 'input_invalid' };
    }
    if (!args.scan_id && !args.screen) {
      return {
        ok: false,
        error: 'Provide either scan_id or screen condition',
        code: 'input_invalid',
      };
    }

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_backtest',
      message: `Running backtest from ${args.from} to ${args.to}...`,
      audience: 'user',
    });

    const result = getStore().runBacktest({
      scanId: args.scan_id,
      screen: args.screen,
      from: args.from,
      to: args.to,
      holdDays: args.hold_days,
      stopAtrMult: args.stop_atr_mult,
      benchmark: args.benchmark,
    });

    ctx.emit?.({
      type: 'progress',
      toolName: 'nse_backtest',
      message: `Backtest complete: ${result.summary.total_trades} trades analyzed.`,
      audience: 'user',
      percent: 100,
    });

    return { ok: true, value: JSON.stringify(result, null, 2) };
  },
};

// ---------------------------------------------------------------------------
// nse_get_quote
// ---------------------------------------------------------------------------

const nseGetQuoteTool: Tool<{ symbol: string; exchange?: string }> = {
  name: 'nse_get_quote',
  description:
    'Get EOD quote snapshot for a symbol: latest close, change %, OHLCV, 52w range, RSI, stage, sniper score, composite score. Source: indicators_daily + ohlcv_daily.',
  toolset: 'market',
  capabilities: {},
  cache: { ttlMs: 60_000 },
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Yahoo Finance symbol, e.g. RELIANCE.NS' },
      exchange: {
        type: 'string',
        enum: ['NSE', 'BSE'],
        description: 'Ignored — suffix in symbol handles this',
      },
    },
    required: ['symbol'],
  },
  async execute(args): Promise<ToolResult> {
    if (!args.symbol) {
      return { ok: false, error: 'symbol is required', code: 'input_invalid' };
    }
    const store = getStore();
    const ohlcv = store.getHistory(args.symbol, 2);
    if (ohlcv.length === 0) {
      return { ok: false, error: `No data for ${args.symbol}`, code: 'not_available' };
    }
    const latest = ohlcv.at(-1);
    if (!latest) {
      return { ok: false, error: `No data for ${args.symbol}`, code: 'not_available' };
    }
    const prev = ohlcv.length > 1 ? ohlcv.at(-2) : null;
    const change_pct =
      prev && prev.close > 0 ? ((latest.close - prev.close) / prev.close) * 100 : null;

    const indicators = store.getIndicators(args.symbol, 1);
    const ind = indicators[0] ?? null;

    const yearData = store.getHistory(args.symbol, 252);
    const high_52w = yearData.length > 0 ? Math.max(...yearData.map((r) => r.high)) : null;
    const low_52w = yearData.length > 0 ? Math.min(...yearData.map((r) => r.low)) : null;
    const dist_52wk_high_pct =
      high_52w && high_52w > 0 ? ((latest.close - high_52w) / high_52w) * 100 : null;

    const result = {
      symbol: args.symbol,
      as_of: latest.date,
      close: latest.close,
      change_pct: change_pct !== null ? Math.round(change_pct * 100) / 100 : null,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      volume: latest.volume,
      rvol: ind?.rvol ?? null,
      high_52w,
      low_52w,
      dist_52wk_high_pct:
        dist_52wk_high_pct !== null ? Math.round(dist_52wk_high_pct * 100) / 100 : null,
      rsi_14: ind?.rsi_14 ?? null,
      stage: ind?.stage ?? null,
      sniper_score: ind?.sniper_score ?? null,
      sniper_verdict: ind?.sniper_verdict ?? null,
      setup_type: ind?.setup_type ?? null,
      composite_score: ind?.composite_score ?? null,
    };
    return { ok: true, value: JSON.stringify(result, null, 2) };
  },
};

// ---------------------------------------------------------------------------
// nse_get_index
// ---------------------------------------------------------------------------

const INDEX_MAP: Record<string, string> = {
  NIFTY50: '^NSEI',
  BANKNIFTY: '^NSEBANK',
  SENSEX: '^BSESN',
  NIFTYIT: '^CNXIT',
  NIFTYPHARMA: '^CNXPHARMA',
  NIFTYFMCG: '^CNXFMCG',
  NIFTYMETAL: '^CNXMETAL',
  NIFTYENERGY: '^CNXENERGY',
  NIFTYREALTY: '^CNXREALTY',
  NIFTYPSUBANK: '^CNXPSUBANK',
  NIFTY500: '^CRSLDX',
  INDIAVIX: '^INDIAVIX',
};

const nseGetIndexTool: Tool<{ index: string }> = {
  name: 'nse_get_index',
  description:
    'Get latest snapshot for a major NSE/BSE index (NIFTY50, BANKNIFTY, SENSEX, etc). Returns level, change%, 52w range, stage, sniper_score, RSI. Source: ohlcv_daily + indicators_daily.',
  toolset: 'market',
  capabilities: {},
  cache: { ttlMs: 60_000 },
  schema: {
    type: 'object',
    properties: {
      index: {
        type: 'string',
        enum: Object.keys(INDEX_MAP),
        description: 'Index name: NIFTY50, BANKNIFTY, SENSEX, NIFTYIT, etc.',
      },
    },
    required: ['index'],
  },
  async execute(args): Promise<ToolResult> {
    if (!args.index) {
      return { ok: false, error: 'index is required', code: 'input_invalid' };
    }
    const symbol = INDEX_MAP[args.index];
    if (!symbol) {
      return { ok: false, error: `Unknown index: ${args.index}`, code: 'input_invalid' };
    }
    const store = getStore();
    const ohlcv = store.getHistory(symbol, 2);
    const latest = ohlcv.at(-1);
    if (!latest) {
      return {
        ok: false,
        error: `No data for index ${args.index} (${symbol})`,
        code: 'not_available',
      };
    }
    const prev = ohlcv.length > 1 ? ohlcv.at(-2) : null;
    const change_pct =
      prev && prev.close > 0 ? ((latest.close - prev.close) / prev.close) * 100 : null;
    const yearData = store.getHistory(symbol, 252);
    const high_52w = yearData.length > 0 ? Math.max(...yearData.map((r) => r.high)) : null;
    const low_52w = yearData.length > 0 ? Math.min(...yearData.map((r) => r.low)) : null;
    const indicators = store.getIndicators(symbol, 1);
    const ind = indicators[0] ?? null;
    const result = {
      index: args.index,
      symbol,
      as_of: latest.date,
      level: latest.close,
      change_pct: change_pct !== null ? Math.round(change_pct * 100) / 100 : null,
      day_high: latest.high,
      day_low: latest.low,
      high_52w,
      low_52w,
      stage: ind?.stage ?? null,
      sniper_score: ind?.sniper_score ?? null,
      ema_stack: ind?.ma_stack ?? null,
      rsi_14: ind?.rsi_14 ?? null,
      macd_hist: ind?.macd_hist ?? null,
    };
    return { ok: true, value: JSON.stringify(result, null, 2) };
  },
};

// ---------------------------------------------------------------------------
// nse_get_fii_dii
// ---------------------------------------------------------------------------

const nseGetFiiDiiTool: Tool<{ date?: string; days?: number }> = {
  name: 'nse_get_fii_dii',
  description:
    'Get FII/DII institutional net flows by date. Returns pre-fetched data from fii_dii_daily table. Use fetch-fii-dii CLI command to populate.',
  toolset: 'market',
  capabilities: { network: { allowedHosts: ['www.nseindia.com'] } },
  cache: { ttlMs: 3_600_000 },
  schema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Single date YYYY-MM-DD. Defaults to latest stored row.',
      },
      days: { type: 'number', description: 'Last N days of data (overrides date).' },
    },
    required: [],
  },
  async execute(args): Promise<ToolResult> {
    const rows = getStore().getFiiDii({ date: args.date, days: args.days });
    if (rows.length === 0) {
      return {
        ok: false,
        error: 'No FII/DII data. Run: nse-market-data fetch-fii-dii',
        code: 'not_available',
      };
    }
    return { ok: true, value: JSON.stringify(rows, null, 2) };
  },
};

// ---------------------------------------------------------------------------
// nse_get_corporate_actions
// ---------------------------------------------------------------------------

const nseGetCorporateActionsTool: Tool<{
  symbol: string;
  from_date?: string;
  to_date?: string;
}> = {
  name: 'nse_get_corporate_actions',
  description:
    'Get corporate actions (dividends, splits, bonus, rights) for a symbol from local DB. Populate with: nse-market-data fetch-corporate-actions --symbol SYM',
  toolset: 'market',
  capabilities: {},
  schema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Yahoo Finance symbol e.g. RELIANCE.NS' },
      from_date: {
        type: 'string',
        description: 'Filter from date YYYY-MM-DD (default: 1 year ago)',
      },
      to_date: { type: 'string', description: 'Filter to date YYYY-MM-DD (default: today)' },
    },
    required: ['symbol'],
  },
  async execute(args): Promise<ToolResult> {
    if (!args.symbol) {
      return { ok: false, error: 'symbol is required', code: 'input_invalid' };
    }
    const rows = getStore().getCorporateActions(args.symbol, args.from_date, args.to_date);
    if (rows.length === 0) {
      return {
        ok: false,
        error: `No corporate actions for ${args.symbol}`,
        code: 'not_available',
      };
    }
    return { ok: true, value: JSON.stringify(rows, null, 2) };
  },
};

// ---------------------------------------------------------------------------
// nse_get_bulk_block
// ---------------------------------------------------------------------------

const nseGetBulkBlockTool: Tool<{ date?: string; symbol?: string }> = {
  name: 'nse_get_bulk_block',
  description:
    'Get bulk and block deals by date or symbol. Defaults to latest stored date. Populate with: nse-market-data fetch-bulk-block',
  toolset: 'market',
  capabilities: {},
  schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Filter by date YYYY-MM-DD' },
      symbol: { type: 'string', description: 'Filter by symbol e.g. RELIANCE.NS' },
    },
    required: [],
  },
  async execute(args): Promise<ToolResult> {
    const rows = getStore().getBulkBlockDeals({ date: args.date, symbol: args.symbol });
    if (rows.length === 0) {
      return { ok: false, error: 'No bulk/block deal data found', code: 'not_available' };
    }
    return { ok: true, value: JSON.stringify(rows, null, 2) };
  },
};

const nseRefreshScansTool: Tool = {
  name: 'nse_refresh_scans',
  description:
    'Reload all built-in scan definitions from the bundled scans/ directory into the local database. Run this if nse_run_scan reports a scan not found.',
  toolset: 'market',
  capabilities: {},
  schema: { type: 'object', properties: {} },
  async execute(_args, _ctx): Promise<ToolResult> {
    const store = getStore();
    const scansDir = join(getPackageRoot(), 'scans');
    const rows: SavedScanRow[] = [];

    try {
      for (const entry of readdirSync(scansDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const file of readdirSync(join(scansDir, entry.name))) {
          if (!file.endsWith('.json')) continue;
          const raw = readFileSync(join(scansDir, entry.name, file), 'utf-8');
          const parsed = JSON.parse(raw) as SavedScanRow;
          rows.push({ ...parsed, category: parsed.category ?? entry.name, is_builtin: 1 });
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: `Could not read scans directory at ${scansDir}: ${(err as Error).message}`,
        code: 'execution_failed',
      };
    }

    if (rows.length === 0) {
      return { ok: false, error: `No scan files found at ${scansDir}`, code: 'not_available' };
    }

    const result = store.upsertScans(rows);
    return { ok: true, value: `Loaded ${result.upserted} scan definitions.` };
  },
};

/** v2 plugin entry point — registers all tools via EthosPluginApi. */
export const plugin: EthosPlugin = {
  activate(api: EthosPluginApi) {
    for (const tool of createNseMarketDataTools()) {
      api.registerTool(tool);
    }
  },
};

/** Backward-compatible activate function for v1 hosts. */
export function activate(api: { registerTool(tool: Tool): void }): void {
  for (const tool of createNseMarketDataTools()) {
    api.registerTool(tool);
  }
}

export function createNseMarketDataTools(): Tool[] {
  // Tool<TArgs> is contravariant on TArgs — typed tools must widen to Tool<unknown>.
  const tools: Tool[] = [
    nseMarketCleanTool as Tool,
    nseMarketBackfillTool as Tool,
    nseMarketUpdateTool as Tool,
    nseWatchlistAddTool as Tool,
    nseWatchlistRemoveTool as Tool,
    nseWatchlistShowTool as Tool,
    nseMarketHistoryTool as Tool,
    nseMarketScreenTool as Tool,
    nseRunScanTool as Tool,
    nseInvokeSkillTool as Tool,
    nseMarketBriefTool as Tool,
    nseMarketIndicatorsTool as Tool,
    nseComputeIndicatorsTool as Tool,
    nseWatchdogTool as Tool,
    nseBacktestTool as Tool,
    nseGetQuoteTool as Tool,
    nseGetIndexTool as Tool,
    nseGetFiiDiiTool as Tool,
    nseGetCorporateActionsTool as Tool,
    nseGetBulkBlockTool as Tool,
    nseRefreshScansTool,
  ];
  return tools;
}
