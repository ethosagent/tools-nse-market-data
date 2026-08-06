// Ethos Tool wrappers around MarketDataStore
// Implemented per Section 14 of tools-nse-market-data.md

import { existsSync, readdirSync, readFileSync } from 'node:fs';

import type { EthosPlugin, EthosPluginApi } from '@ethosagent/plugin-sdk';
import type { Tool, ToolResult } from '@ethosagent/types';

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------

import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDashboardHtml } from './dashboard';
import { fetchQuote, searchSymbol } from './fetcher';
import { fetchFiiDii, fetchGiftNifty } from './nse-fetcher';
import type { IndexConstituentSeedRow, InstrumentSeedRow, SavedScanRow } from './schema';
import { SqlGuardError } from './sql-guard';
import type { InstrumentRow, SyncResult } from './store';
import { MarketDataStore } from './store';

function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return join(dirname(__filename), '..');
}

function getDbPath(): string {
  return process.env.NSE_MARKET_DATA_DB ?? join(homedir(), '.ethos', 'market-data', 'market.db');
}

function withStore<T>(fn: (store: MarketDataStore) => T): T {
  const store = new MarketDataStore(getDbPath());
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

async function withStoreAsync<T>(fn: (store: MarketDataStore) => Promise<T>): Promise<T> {
  const store = new MarketDataStore(getDbPath());
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// Per-tool arg interfaces
// ---------------------------------------------------------------------------

interface BackfillArgs {
  symbols?: string;
  from_date?: string;
  days?: number;
  limit?: number;
  skip_synced?: boolean;
  concurrency?: number;
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
    return withStore((store) => {
      const result = store.clean();
      return {
        ok: true,
        value: `Cleaned database: ${result.rowsDeleted.ohlcv} OHLCV rows, ${result.rowsDeleted.syncMeta} sync records, ${result.rowsDeleted.watchlist} watchlist entries deleted.`,
      };
    });
  },
};

const nseMarketBackfillTool: Tool<BackfillArgs> = {
  name: 'nse_market_backfill',
  description:
    'Download daily OHLCV history for NSE stocks and store locally. Supports batched execution via limit + skip_synced params — call repeatedly to process all ~2,900 symbols without a single long-running call. Pass days: 1825 for 5 years of history.',
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
      limit: {
        type: 'number',
        description:
          'Maximum number of symbols to process in this call (default: all). Use to process in batches, e.g. limit: 200. Combine with skip_synced: true to resume where a previous call left off.',
      },
      skip_synced: {
        type: 'boolean',
        description:
          'Skip symbols already in sync_meta (already synced). Use with limit to batch-process: call repeatedly until backfill-status shows complete.',
      },
      concurrency: {
        type: 'number',
        description:
          'Number of symbols to fetch in parallel (default: 5). Increase for faster backfills on fast connections.',
      },
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    return withStoreAsync(async (store) => {
      const daysBack = args.days ?? 365;
      const fromDate =
        args.from_date ||
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

      // Apply limit before delegating to backfillAll
      if (args.limit && args.limit > 0) {
        symbols = symbols.slice(0, args.limit);
      }

      ctx.emit?.({
        type: 'progress',
        toolName: 'nse_market_backfill',
        message: `Starting backfill for ${symbols.length} symbols from ${fromDate}...`,
        audience: 'user',
        percent: 0,
      });

      const { results, failed } = await store.backfillAll(
        symbols,
        fromDate,
        (done, total, _sym, errorCount) => {
          if (done % 10 === 0 || done === total) {
            ctx.emit?.({
              type: 'progress',
              toolName: 'nse_market_backfill',
              message: `${done}/${total} symbols synced${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
              audience: 'user',
              percent: Math.round((done / total) * 100),
            });
          }
        },
        {
          concurrency: args.concurrency,
          skipSynced: args.skip_synced,
        },
      );

      const totalRows = results.reduce((sum, r) => sum + r.rowsInserted, 0);

      return {
        ok: true,
        value: [
          `Backfill complete: ${results.length} symbols processed, ${totalRows} rows inserted.`,
          failed.length > 0
            ? `${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ` (+${failed.length - 5} more)` : ''}.`
            : 'No failures.',
        ].join('\n'),
      };
    });
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
    return withStoreAsync(async (store) => {
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
    });
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
    return withStore((store) => {
      store.watchlistAdd(args.symbol, args.list_name, args.notes);
      const list = args.list_name ?? 'default';
      return { ok: true, value: `Added ${args.symbol} to watchlist '${list}'.` };
    });
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
    return withStore((store) => {
      store.watchlistRemove(args.symbol, args.list_name);
      const list = args.list_name ?? 'default';
      return { ok: true, value: `Removed ${args.symbol} from watchlist '${list}'.` };
    });
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
    return withStore((store) => {
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
    });
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
    return withStore((store) => {
      const days = Math.min(args.days ?? 252, 504);
      const rows = store.getHistory(args.symbol, days);
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
    });
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
    return withStore((store) => {
      const rows = store.screen({
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
    });
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
    return withStore((store) => {
      const db = (store as unknown as { db: import('node-sqlite3-wasm').Database }).db;

      // Look up the scan
      const s1 = db.prepare('SELECT sql_template, name FROM saved_scans WHERE scan_id = ?');
      const scanRow = s1.get([args.scan_id]) as { sql_template: string; name: string } | null;
      s1.finalize();
      if (!scanRow) {
        return {
          ok: false,
          error: `Scan '${args.scan_id}' not found. Run nse_refresh_scans to load built-in scan definitions.`,
          code: 'not_available',
        };
      }

      // Determine query date
      const queryDate =
        args.date ||
        (() => {
          const s2 = db.prepare('SELECT MAX(date) as d FROM indicators_daily');
          const row = s2.get([]) as { d: string | null } | null;
          s2.finalize();
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
        const s3 = db.prepare(sql);
        rows = s3.all([queryDate, limit]) as typeof rows;
        s3.finalize();
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
    });
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

    return withStore((store) => {
      const db = (store as unknown as { db: import('node-sqlite3-wasm').Database }).db;
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
        const sInd = db.prepare(
          `SELECT * FROM indicators_daily WHERE symbol = ?
           ORDER BY date DESC LIMIT 90`,
        );
        const rows = sInd.all([symbol]);
        sInd.finalize();
        const history = store.getHistory(symbol, 90);
        dataContext = { symbol, indicators: rows, ohlcv: history };
      } else if (marketSkills.includes(skillId)) {
        const sMkt = db.prepare('SELECT * FROM market_state_daily ORDER BY date DESC LIMIT 20');
        const rows = sMkt.all([]);
        sMkt.finalize();
        dataContext = { market_state: rows };
      } else if (sectorSkills.includes(skillId)) {
        const sSec = db.prepare('SELECT * FROM sector_state_daily ORDER BY date DESC LIMIT 28');
        const rows = sSec.all([]);
        sSec.finalize();
        dataContext = { sector_state: rows };
      } else if (watchlistSkills.includes(skillId)) {
        const sLatest = db.prepare('SELECT MAX(date) as d FROM indicators_daily');
        const latestDateRow = sLatest.get([]) as { d: string | null } | null;
        sLatest.finalize();
        const latestDate = latestDateRow?.d ?? new Date().toISOString().slice(0, 10);
        const sWl = db.prepare(
          `SELECT id.*, i.name, i.sector, i.market_cap_band
           FROM indicators_daily id
           JOIN instruments i ON id.symbol = i.symbol
           JOIN watchlist w ON id.symbol = w.symbol
           WHERE id.date = ?
           ORDER BY id.composite_score DESC NULLS LAST
           LIMIT 10`,
        );
        const rows = sWl.all([latestDate]);
        sWl.finalize();
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
    });
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
    return withStore((store) => {
      const brief = store.getMarketBrief(args.date);
      return { ok: true, value: JSON.stringify(brief, null, 2) };
    });
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
    return withStore((store) => {
      const rows = store.getIndicators(args.symbol, args.days ?? 63);
      if (rows.length === 0) {
        return {
          ok: false,
          error: `No indicator data for ${args.symbol}. Run compute-indicators first.`,
          code: 'not_available',
        };
      }
      return { ok: true, value: JSON.stringify(rows, null, 2) };
    });
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

    return withStore((store) => {
      const result = store.checkWatchdog({
        symbol: args.symbol,
        condition: args.condition,
        cooldownDays: args.cooldown_days,
        date: args.date,
      });

      return { ok: true, value: JSON.stringify(result, null, 2) };
    });
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
    return withStoreAsync(async (store) => {
      ctx.emit?.({
        type: 'progress',
        toolName: 'nse_compute_indicators',
        message: 'Computing technical indicators…',
        audience: 'user',
        percent: 0,
      });

      const result = await store.computeIndicators({
        symbol: args.symbol || undefined,
        from: args.from || undefined,
        to: args.to || undefined,
      });

      ctx.emit?.({
        type: 'progress',
        toolName: 'nse_compute_indicators',
        message: 'Computing market breadth…',
        audience: 'user',
        percent: 80,
      });

      const marketResult = store.computeMarketState({
        from: args.from || undefined,
        to: args.to || undefined,
      });

      ctx.emit?.({
        type: 'progress',
        toolName: 'nse_compute_indicators',
        message: 'Computing sector state…',
        audience: 'user',
        percent: 90,
      });

      const sectorResult = store.computeSectorState({
        from: args.from || undefined,
        to: args.to || undefined,
      });

      return {
        ok: true,
        value: `Indicators: ${result.processed} symbols, ${result.dateCount} dates computed.\nMarket state: ${marketResult.processed} dates.\nSector state: ${sectorResult.processed} dates.\n\nData is ready for scans, screening, and analysis.`,
      };
    });
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

    return withStore((store) => {
      const result = store.runBacktest({
        scanId: args.scan_id || undefined,
        screen: args.screen || undefined,
        from: args.from,
        to: args.to,
        holdDays: args.hold_days,
        stopAtrMult: args.stop_atr_mult,
        benchmark: args.benchmark || undefined,
      });

      ctx.emit?.({
        type: 'progress',
        toolName: 'nse_backtest',
        message: `Backtest complete: ${result.summary.total_trades} trades analyzed.`,
        audience: 'user',
        percent: 100,
      });

      return { ok: true, value: JSON.stringify(result, null, 2) };
    });
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
    return withStore((store) => {
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
    });
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
    return withStore((store) => {
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
    });
  },
};

// ---------------------------------------------------------------------------
// nse_get_fii_dii
// ---------------------------------------------------------------------------

const nseGetFiiDiiTool: Tool<{ date?: string; days?: number }> = {
  name: 'nse_get_fii_dii',
  description:
    'Get FII/DII institutional net flows by date. Returns stored data from fii_dii_daily table. Use nse_fetch_fii_dii to refresh.',
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
    return withStore((store) => {
      const rows = store.getFiiDii({ date: args.date, days: args.days });
      if (rows.length === 0) {
        return {
          ok: false,
          error: 'No FII/DII data. Run: nse-market-data fetch-fii-dii',
          code: 'not_available',
        };
      }
      return { ok: true, value: JSON.stringify(rows, null, 2) };
    });
  },
};

// ---------------------------------------------------------------------------
// nse_fetch_fii_dii
// ---------------------------------------------------------------------------

const nseFetchFiiDiiTool: Tool<{ days?: number; date?: string }> = {
  name: 'nse_fetch_fii_dii',
  description:
    'Fetch FII/DII institutional net flows from NSE and store in fii_dii_daily. Use days to backfill multiple trading days (default: 1 = today). Use date to fetch a specific day.',
  toolset: 'market',
  capabilities: { network: { allowedHosts: ['www.nseindia.com'] } },
  schema: {
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: 'Number of past trading days to fetch and store (default: 1).',
      },
      date: {
        type: 'string',
        description: 'Specific date YYYY-MM-DD. Ignored when days > 1.',
      },
    },
    required: [],
  },
  async execute(args, ctx): Promise<ToolResult> {
    return withStoreAsync(async (store) => {
      const days = args.days ?? 1;
      ctx.emit?.({
        type: 'progress',
        toolName: 'nse_fetch_fii_dii',
        message:
          days > 1 ? `Fetching FII/DII data for last ${days} days…` : 'Fetching FII/DII data…',
        audience: 'user',
      });

      let totalSaved = 0;
      const lines: string[] = [];

      if (days > 1) {
        const today = new Date();
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          const rows = await fetchFiiDii(dateStr);
          if (rows.length > 0) {
            const saved = store.upsertFiiDii(rows);
            totalSaved += saved;
            lines.push(`${dateStr}: ${saved} rows`);
          }
        }
      } else {
        const rows = await fetchFiiDii(args.date);
        totalSaved = store.upsertFiiDii(rows);
        const dateStr = args.date ?? new Date().toISOString().slice(0, 10);
        lines.push(`${dateStr}: ${totalSaved} rows`);
      }

      if (totalSaved === 0) {
        return { ok: true, value: 'No FII/DII data returned (market may be closed today).' };
      }

      return {
        ok: true,
        value: `Saved ${totalSaved} FII/DII rows.\n\n${lines.join('\n')}`,
      };
    });
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
    return withStore((store) => {
      const rows = store.getCorporateActions(args.symbol, args.from_date, args.to_date);
      if (rows.length === 0) {
        return {
          ok: false,
          error: `No corporate actions for ${args.symbol}`,
          code: 'not_available',
        };
      }
      return { ok: true, value: JSON.stringify(rows, null, 2) };
    });
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
    return withStore((store) => {
      const rows = store.getBulkBlockDeals({ date: args.date, symbol: args.symbol });
      if (rows.length === 0) {
        return { ok: false, error: 'No bulk/block deal data found', code: 'not_available' };
      }
      return { ok: true, value: JSON.stringify(rows, null, 2) };
    });
  },
};

// ---------------------------------------------------------------------------
// nse_get_gift_nifty
// ---------------------------------------------------------------------------

const nseGetGiftNiftyTool: Tool = {
  name: 'nse_get_gift_nifty',
  description:
    'Get live GIFT Nifty futures price and market direction signal. GIFT Nifty trades 21 hours/day and shows the expected gap-up or gap-down when Indian markets open. Returns current price, change%, implied gap vs Nifty 50 spot, and expiry.',
  toolset: 'market',
  capabilities: { network: { allowedHosts: ['www.nseindia.com'] } },
  schema: { type: 'object', properties: {} },
  async execute(_args): Promise<ToolResult> {
    // Get Nifty 50 spot close from DB for implied gap calculation
    let spotClose: number | undefined;
    try {
      spotClose = withStore((store) => {
        const rows = store.getHistory('^NSEI', 1);
        if (rows.length > 0 && rows[0]) {
          return rows[0].close;
        }
        return undefined;
      });
    } catch {
      // DB may not have Nifty spot — proceed without it
    }

    const data = await fetchGiftNifty(spotClose);
    if (!data) {
      return {
        ok: false,
        error:
          'Could not fetch GIFT Nifty data from NSE. NSE API may require a fresh session — retry in a few seconds.',
        code: 'execution_failed',
      };
    }

    const direction = data.changePct >= 0 ? '▲' : '▼';
    const gapStr =
      data.impliedGapPct !== null
        ? `\nImplied gap vs Nifty spot: ${data.impliedGapPct >= 0 ? '+' : ''}${data.impliedGapPct}%`
        : '';

    const summary = [
      `GIFT Nifty  ${direction} ${data.lastPrice.toFixed(2)}`,
      `Change: ${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)} (${data.changePct >= 0 ? '+' : ''}${data.changePct.toFixed(2)}%)`,
      `Open: ${data.open.toFixed(2)}  High: ${data.high.toFixed(2)}  Low: ${data.low.toFixed(2)}`,
      `Prev close: ${data.prevClose.toFixed(2)}  Volume: ${data.totalVolume.toLocaleString()}`,
      `Expiry: ${data.expiryDate}${gapStr}`,
      `As of: ${data.timestamp}`,
    ].join('\n');

    return { ok: true, value: summary };
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

    return withStore((store) => {
      const result = store.upsertScans(rows);
      return { ok: true, value: `Loaded ${result.upserted} scan definitions.` };
    });
  },
};

interface DashboardArgs {
  date?: string;
  top_n?: number;
}

const nseMarketDashboardTool: Tool<DashboardArgs> = {
  name: 'nse_market_dashboard',
  description:
    'Generate the complete NSE market dashboard as self-contained HTML. ' +
    'Shows market health, advance-decline trend, sector rotation, FII/DII flows, ' +
    'stage distribution, and top momentum stocks. Pass the returned HTML to ' +
    'dashboard_add_panel (block_type: html) or render_html to display.',
  toolset: 'market',
  capabilities: {},
  maxResultChars: 500_000,
  cache: { ttlMs: 300_000 },
  schema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'YYYY-MM-DD. Defaults to the latest date with indicator data.',
      },
      top_n: {
        type: 'number',
        description: 'Number of top Stage 2 stocks to include (default 20, max 50).',
      },
    },
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const topN = args.top_n == null || args.top_n <= 0 ? 20 : Math.min(args.top_n, 50);
    return withStore((store) => {
      const data = store.getDashboardData(args.date, topN);
      const html = generateDashboardHtml(data);
      return { ok: true, value: html };
    });
  },
};

// ---------------------------------------------------------------------------
// nse_market_query — read-only SQL escape hatch
// ---------------------------------------------------------------------------

/**
 * Inlined schema. Kept in sync with schema.ts by the drift-gate test in
 * src/__tests__/tools.test.ts, which asserts every column of every migrated
 * table appears in this string.
 */
export const MARKET_QUERY_DESCRIPTION = `Run one read-only SQL SELECT against the local NSE market database and get JSON rows back. Use it for questions the curated tools do not cover — prefer nse_run_scan or nse_market_screen when one of them already answers the question, since they encode domain judgement this tool does not.

RULES
- One statement only. No semicolons, no PRAGMA, no ATTACH, no writes: the connection is opened read-only.
- Start with SELECT or WITH ... SELECT.
- Alias every output column. Duplicate names collapse into one key: SELECT i.symbol, c.symbol ... returns a single "symbol".
- Results are capped: limit defaults to 200, max 1000, and ~30,000 characters of JSON. A truncated result without an ORDER BY is an arbitrary sample.
- "columns": [] means the query returned zero rows, not that the table has no columns.
- There is no query timeout. A cartesian product over ohlcv_daily (millions of rows) blocks the whole agent until it finishes, so always constrain by date or symbol.

JOIN KEYS
- ohlcv_daily and indicators_daily both key on (symbol, date).
- instruments.symbol is the join target for both.
- index_constituents(index_symbol, member_symbol) maps an index to its members.
- Universe filter every built-in scan applies: instruments.instrument_type = 'equity' AND instruments.is_active = 1.
- Latest date idiom: WHERE date = (SELECT MAX(date) FROM indicators_daily).

TABLES
instruments: symbol, name, exchange, sector, isin, added_at, industry, market_cap_band, instrument_type ('equity' or 'index'), index_category, is_active, as_of_date
ohlcv_daily: symbol, date, open, high, low, close, volume, adj_close, adj_factor, delivery_qty, delivery_pct
sync_meta: symbol, last_sync, last_date
watchlist: symbol, list_name, notes, added_at
watchlist_alerts: symbol, condition_hash, last_alerted, alert_count
index_constituents: index_symbol, member_symbol, weight, as_of_date
ath_tracker: symbol, ath_price, ath_date
saved_scans: scan_id, name, category, description, sql_template, tags, is_builtin, created_at
schema_version: version, applied_at, description
fii_dii_daily: date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
corporate_actions: symbol, ex_date, purpose, value
bulk_block_deals: id, date, symbol, client_name, deal_type, trade_type, quantity, price

indicators_daily — keyed on symbol, date, then:
  Trend / moving averages: ema_20, ema_50, ema_100, ema_200, sma_50, sma_200, ma_stack, ema_50_slope
  Momentum: rsi_14, macd, macd_signal, macd_hist, macd_hist_prev, adx, adx_di_plus, adx_di_minus, stoch_k, stoch_d, cci_20, williams_r, psar, psar_signal, psar_signal_prev, roc_5, return_1d, return_1w, return_1m, return_3m, return_6m, return_1y, return_ytd
  Relative strength: rs_vs_segment, rs_vs_broad, rs_rank_in_segment, rs_rank_in_sector
  Volatility / range: atr_14, adr_pct, bb_upper, bb_lower, bb_middle, bb_width, keltner_upper, keltner_lower, donchian_upper_20, donchian_lower_20
  Volume: rvol, vol_sma_20, avg_dollar_volume_20, delivery_pct, delivery_ma_20, obv, obv_slope_5d, close_position_ratio
  VWAP: vwap, closed_above_vwap
  Price levels: dist_52wk_high_pct, dist_52wk_low_pct, dist_ath_pct, pct_from_ema20, pct_from_ema50, pct_from_ema200, price_percentile_52w
  Candle: candle_pattern
  Multi-timeframe: ema_20_weekly, ema_50_weekly, close_vs_ema20w, close_vs_ema50w, rsi_14_weekly, macd_hist_weekly, ema_10_monthly, close_vs_ema10m, tf_alignment_score
  Stage: stage
  Sniper: sniper_score, sniper_verdict
  Composite: composite_score, composite_grade
  Setup: setup_type, setup_quality
  Chart patterns: base_pattern, pivot_price, buy_range_top, base_start_date, base_length_weeks, base_depth_pct, base_quality_score, near_pivot

market_state_daily — one row per date: date, nifty_close, nifty_vs_ema50, nifty_vs_ema200, nifty_ema50_slope, nifty_stage, nifty_sniper_score, advances, declines, unchanged_count, ad_ratio, pct_above_50ma, pct_above_200ma, new_highs, new_lows, up_volume, down_volume, pct_up_2, pct_down_2, pct_above_vwap, ema_stack_bull_pct, ema200_breadth_pct, ema50_breadth_pct, macd_breadth_pct, adx_trending_pct, avg_rsi, pct_oversold, pct_overbought, smart_money_acc_count, smart_money_dist_count, bull_divergence_count, bear_divergence_count, bb_squeeze_count, gap_ups_count, gap_downs_count, vol_surges_count, stage2_pct, stage4_pct, mood_score, india_vix

sector_state_daily — one row per (date, sector): date, sector, sector_index_symbol, sector_return_1d, sector_return_1w, sector_return_1m, sector_return_3m, sector_return_6m, sector_return_ytd, rs_rank, rs_rank_prev_week, rs_rank_delta_1w, pct_members_uptrend, pct_members_stage2, advances, declines, avg_member_rs, avg_member_composite, top_stock_symbol, top_stock_return_1d, breadth_pct`;

interface MarketQueryArgs {
  sql?: string;
  limit?: number;
}

const nseMarketQueryTool: Tool<MarketQueryArgs> = {
  name: 'nse_market_query',
  description: MARKET_QUERY_DESCRIPTION,
  toolset: 'market_query',
  capabilities: {},
  maxResultChars: 40000,
  cache: { ttlMs: 60_000 },
  schema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description:
          'A single read-only SELECT (or WITH ... SELECT). No semicolons, no PRAGMA, no ATTACH, no writes. Alias every output column — duplicate names collapse.',
      },
      limit: {
        type: 'number',
        description: 'Max rows to return (default 200, max 1000). Out-of-range values are clamped.',
      },
    },
    required: ['sql'],
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const sql = (args.sql ?? '').trim();
    if (sql.length === 0) {
      return { ok: false, error: 'sql is required.', code: 'input_invalid' };
    }

    const dbPath = getDbPath();
    if (!existsSync(dbPath)) {
      return {
        ok: false,
        error: `Market database not found at ${dbPath}. Run nse_market_backfill first.`,
        code: 'not_available',
      };
    }

    try {
      return withStore((store) => {
        const result = store.query(sql, args.limit ?? 200);
        const note =
          result.truncationReason === 'byte_budget'
            ? 'Truncated on result size. Select fewer columns or add a narrower WHERE.'
            : result.truncationReason === 'row_limit'
              ? 'Truncated at the row limit. There may be more rows — add an ORDER BY so the cut is not arbitrary, or narrow the WHERE.'
              : undefined;
        return {
          ok: true,
          value: JSON.stringify({
            row_count: result.rows.length,
            truncated: result.truncated,
            elapsed_ms: result.elapsedMs,
            columns: result.columns,
            rows: result.rows,
            ...(note ? { note } : {}),
          }),
        };
      });
    } catch (err) {
      if (err instanceof SqlGuardError) {
        return { ok: false, error: err.message, code: 'input_invalid' };
      }
      return {
        ok: false,
        error: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        code: 'execution_failed',
      };
    }
  },
};

// ---------------------------------------------------------------------------
// nse_instrument_add — curation
// ---------------------------------------------------------------------------

interface InstrumentAddArgs {
  symbol?: string;
  name?: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  isin?: string;
  market_cap_band?: string;
  instrument_type?: 'equity' | 'index';
  index_category?: string;
  members?: Array<{ symbol: string; weight?: number }>;
  as_of_date?: string;
  validate?: boolean;
  update?: boolean;
  backfill?: boolean;
  backfill_days?: number;
}

const SYMBOL_PATTERN = /^\^?[A-Z0-9&-]+(\.[A-Z]{2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only when the feed positively established that the symbol does not exist.
 * Everything else — timeouts, 429s, 5xx, unrecognised errors — is "could not
 * validate" and must proceed. The else branch defaults to proceed on purpose: a
 * new failure mode added to fetcher.ts must not silently start blocking
 * registrations.
 */
function isDefinitiveMiss(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('symbol not found:') || msg.includes('no data found, symbol may be delisted');
}

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

async function notFoundResult(symbol: string): Promise<ToolResult> {
  let suggestion = '';
  try {
    const candidates = await searchSymbol(symbol);
    if (candidates.length > 0) {
      suggestion = ` Did you mean: ${candidates
        .slice(0, 3)
        .map((c) => c.symbol)
        .join(', ')}?`;
    }
  } catch {
    // Suggestions are a courtesy — a second failure must not change the verdict.
  }
  return {
    ok: false,
    error: `'${symbol}' was not found on the price feed. Nothing was registered.${suggestion} Pass validate: false to add it anyway.`,
    code: 'not_available',
  };
}

function formatInstrument(
  row: InstrumentRow,
  coverage: ReturnType<MarketDataStore['getSymbolCoverage']>,
): string {
  const lines = [
    `  name             ${row.name}`,
    `  exchange         ${row.exchange}`,
    `  sector           ${row.sector ?? '-'}`,
    `  industry         ${row.industry ?? '-'}`,
    `  isin             ${row.isin ?? '-'}`,
    `  instrument_type  ${row.instrument_type}`,
    `  index_category   ${row.index_category ?? '-'}`,
    `  is_active        ${row.is_active}`,
  ];
  lines.push(
    coverage.rows > 0
      ? `  price history    ${coverage.rows.toLocaleString('en-IN')} rows, ${coverage.firstDate} → ${coverage.lastDate}`
      : '  price history    none',
  );
  return lines.join('\n');
}

/** Attach constituents to an index. Members are upserted; unknown ones are reported. */
function attachMembers(
  store: MarketDataStore,
  indexSymbol: string,
  members: Array<{ symbol: string; weight?: number }>,
  asOfDate: string,
): { attached: number; deduped: number; unknown: string[]; weightSum: number | null } {
  const bySymbol = new Map<string, number | null>();
  for (const m of members) {
    bySymbol.set(m.symbol.trim().toUpperCase(), m.weight ?? null);
  }
  const deduped = members.length - bySymbol.size;

  const rows: IndexConstituentSeedRow[] = [];
  for (const [symbol, weight] of bySymbol) {
    rows.push({ index_symbol: indexSymbol, member_symbol: symbol, weight, as_of_date: asOfDate });
  }
  store.upsertIndexConstituents(rows);

  const known = new Set(store.listInstrumentSymbols());
  const unknown = rows.map((r) => r.member_symbol).filter((s) => !known.has(s));

  const weights = rows.map((r) => r.weight).filter((w): w is number => w !== null);
  const weightSum = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) : null;

  return { attached: rows.length, deduped, unknown, weightSum };
}

const nseInstrumentAddTool: Tool<InstrumentAddArgs> = {
  name: 'nse_instrument_add',
  description:
    'Register an NSE instrument (equity or index) that already exists on the price feed. ' +
    'Confirms the symbol against the feed before registering; a symbol the feed positively ' +
    'rejects is refused, a symbol that merely could not be checked is registered with a caveat. ' +
    'Does NOT download price history unless backfill is true — without it the instrument is ' +
    'invisible to nse_run_scan, nse_market_screen and nse_market_indicators. Idempotent: an ' +
    'existing symbol is reported with its current values, not overwritten (pass update: true to ' +
    'change it). For an index, pass instrument_type: "index" and optionally members to attach ' +
    'constituents — members are attached even when the index is already registered.',
  toolset: 'market',
  capabilities: { network: { allowedHosts: ['query1.finance.yahoo.com'] } },
  maxResultChars: 4000,
  requiresApproval: false,
  schema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'NSE symbol, e.g. ZOMATO.NS. Indices are ^-prefixed, e.g. ^NSEBANK.',
      },
      name: {
        type: 'string',
        description: 'Display name. Auto-filled from the price feed when omitted.',
      },
      exchange: { type: 'string', description: "Exchange code. Default 'NSE'." },
      sector: { type: 'string', description: 'Sector label used by sector scans.' },
      industry: { type: 'string', description: 'Industry label.' },
      isin: { type: 'string', description: 'ISIN, if known.' },
      market_cap_band: {
        type: 'string',
        description: 'Cap segment label, e.g. largecap / midcap / smallcap.',
      },
      instrument_type: {
        type: 'string',
        enum: ['equity', 'index'],
        description: "Default 'equity'. Indices live in the same table with 'index'.",
      },
      index_category: {
        type: 'string',
        description:
          'Only for indices: broad, sector, cap_segment, regime, thematic. Ignored for equities.',
      },
      members: {
        type: 'array',
        description:
          'Only for instrument_type: "index". Constituents to attach, e.g. [{"symbol": "TCS.NS", "weight": 8.2}]. Weights are optional. Members are upserted, never swept.',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            weight: { type: 'number' },
          },
          required: ['symbol'],
        },
      },
      as_of_date: {
        type: 'string',
        description: 'YYYY-MM-DD stamped on the constituent rows. Defaults to today (IST).',
      },
      validate: {
        type: 'boolean',
        description:
          'Check the symbol against the price feed before registering. Default true. Set false for offline use — then name is required.',
      },
      update: {
        type: 'boolean',
        description: 'Overwrite an existing row. Default false, which reports the row instead.',
      },
      backfill: {
        type: 'boolean',
        description:
          'Download price history immediately after registering. Default false. When false the instrument is registered but invisible to nse_run_scan, nse_market_screen and nse_market_indicators until you run nse_market_backfill and nse_compute_indicators.',
      },
      backfill_days: {
        type: 'number',
        description:
          'How many days of history to download. Default 365. Ignored when backfill is false.',
      },
    },
    required: ['symbol'],
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const symbol = (args.symbol ?? '').trim().toUpperCase();
    if (symbol.length === 0) {
      return { ok: false, error: 'symbol is required.', code: 'input_invalid' };
    }
    if (!SYMBOL_PATTERN.test(symbol)) {
      return {
        ok: false,
        error: `'${symbol}' is not a valid symbol. Expected forms: RELIANCE.NS, TATASTEEL.BO, ^NSEBANK.`,
        code: 'input_invalid',
      };
    }

    const instrumentType = args.instrument_type ?? 'equity';
    const members = args.members;
    if (members !== undefined) {
      if (instrumentType !== 'index') {
        return {
          ok: false,
          error: 'members is only valid with instrument_type: "index".',
          code: 'input_invalid',
        };
      }
      if (members.length === 0) {
        return {
          ok: false,
          error: 'Pass members with at least one entry, or omit it.',
          code: 'input_invalid',
        };
      }
    }

    const asOfDate = args.as_of_date ?? todayIst();
    if (!DATE_PATTERN.test(asOfDate)) {
      return { ok: false, error: 'as_of_date must be YYYY-MM-DD.', code: 'input_invalid' };
    }

    const suffixWarning =
      !symbol.startsWith('^') && !/\.[A-Z]{2}$/.test(symbol)
        ? `Note: '${symbol}' has no .NS / .BO suffix. Every other row in this database uses the suffixed form.\n\n`
        : '';

    return withStoreAsync(async (store) => {
      const existing = store.getInstrument(symbol);

      if (existing !== null && args.update !== true) {
        const memberNote =
          members !== undefined
            ? `\n\n${describeMembers(attachMembers(store, symbol, members, asOfDate), asOfDate)}`
            : '';
        return {
          ok: true,
          value: `${suffixWarning}${symbol} is already registered. Current values:\n${formatInstrument(
            existing,
            store.getSymbolCoverage(symbol),
          )}\n\nThe instrument row was not changed. Pass update: true to overwrite these values.${memberNote}`,
        };
      }

      let name = args.name?.trim() || undefined;
      let confirmation: string | null = null;
      let caveat: string | null = null;

      if (args.validate === false) {
        if (name === undefined) {
          return {
            ok: false,
            error:
              'name is required when validate is false — instruments.name is NOT NULL and there is no feed call to source it from.',
            code: 'input_invalid',
          };
        }
        caveat = `Not checked against the price feed (validate: false). If the symbol is wrong, every sync for it will fail silently and this row will sit inert.`;
      } else if (args.backfill !== true || name === undefined) {
        // One feed call, not two: with backfill: true the backfill itself proves the
        // symbol resolves, so fetchQuote runs only when name has to come from somewhere.
        try {
          const quote = await fetchQuote(symbol);
          name = name ?? quote.name;
          confirmation = `Confirmed on the price feed: ${quote.price} ${quote.currency}.`;
        } catch (err) {
          if (isDefinitiveMiss(err)) return notFoundResult(symbol);
          const reason = err instanceof Error ? err.message : String(err);
          if (name === undefined) {
            return {
              ok: false,
              error: `Could not reach the price feed to look up a name for ${symbol} (${reason}), and instruments.name is NOT NULL. Retry, or pass name explicitly.`,
              code: 'input_invalid',
            };
          }
          caveat = `Could not confirm ${symbol} against the price feed — ${reason}. Registered anyway. If the symbol is wrong, the next backfill will return nothing.`;
        }
      }

      // Backfill runs BEFORE the write so a symbol the feed rejects never lands.
      // Legal because the schema declares no foreign keys.
      let backfilled: SyncResult | null = null;
      let backfillError: string | null = null;
      if (args.backfill === true) {
        const days = args.backfill_days ?? 365;
        const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
        try {
          backfilled = await store.backfillSymbol(symbol, fromDate);
        } catch (err) {
          if (isDefinitiveMiss(err)) return notFoundResult(symbol);
          backfillError = err instanceof Error ? err.message : String(err);
          caveat =
            caveat ??
            `Could not confirm ${symbol} against the price feed — ${backfillError}. Registered anyway. If the symbol is wrong, the next backfill will return nothing.`;
        }
      }

      if (name === undefined) {
        return {
          ok: false,
          error: `name is required for ${symbol} — instruments.name is NOT NULL and the feed lookup did not supply one.`,
          code: 'input_invalid',
        };
      }

      const result = store.addInstrument(
        {
          symbol,
          name,
          exchange: args.exchange ?? 'NSE',
          sector: args.sector ?? null,
          industry: args.industry ?? null,
          isin: args.isin ?? null,
          market_cap_band: args.market_cap_band ?? null,
          instrument_type: instrumentType,
          index_category: args.index_category ?? null,
          is_active: 1,
          as_of_date: args.as_of_date ?? null,
        },
        { update: args.update === true },
      );

      const lines: string[] = [];
      if (suffixWarning) lines.push(suffixWarning.trim());
      if (caveat) lines.push(caveat);
      lines.push(
        `${result.status === 'updated' ? 'Updated' : 'Registered'} ${symbol} (${name})${
          instrumentType === 'index' ? ` — index, category: ${args.index_category ?? '-'}` : ''
        }${args.sector ? ` — sector: ${args.sector}` : ''}.`,
      );
      if (confirmation) lines.push(confirmation);

      if (backfilled !== null) {
        lines.push(
          backfilled.rowsInserted === 0
            ? `Backfilled 0 rows — the symbol resolves on the feed but has no candles in the last ${args.backfill_days ?? 365} days. It may be newly listed or suspended. Try a longer backfill_days.`
            : `Backfilled ${backfilled.rowsInserted.toLocaleString('en-IN')} rows (${backfilled.fromDate} → ${backfilled.toDate}). Run nse_compute_indicators to make it scannable.`,
        );
      } else if (backfillError !== null) {
        lines.push(
          `The backfill failed (${backfillError}). Retry it with nse_market_backfill symbols: "${symbol}".`,
        );
      } else {
        lines.push(
          `No price history yet. This symbol is invisible to nse_run_scan, nse_market_screen and nse_market_indicators until you run:\n  nse_market_backfill  symbols: "${symbol}", days: 1825\nthen:\n  nse_compute_indicators`,
        );
      }

      if (members !== undefined) {
        lines.push(describeMembers(attachMembers(store, symbol, members, asOfDate), asOfDate));
      }

      return { ok: true, value: lines.join('\n\n') };
    });
  },
};

function describeMembers(summary: ReturnType<typeof attachMembers>, asOfDate: string): string {
  const parts = [
    `Attached ${summary.attached} constituents as of ${asOfDate}${
      summary.deduped > 0 ? ` (${summary.deduped} duplicate entries collapsed)` : ''
    }.`,
  ];
  if (summary.weightSum !== null && (summary.weightSum < 95 || summary.weightSum > 105)) {
    parts.push(
      `Supplied weights sum to ${summary.weightSum.toFixed(2)}, not ~100 — check whether they are fractions rather than percentages, or whether the list is partial.`,
    );
  }
  if (summary.unknown.length > 0) {
    const shown = summary.unknown.slice(0, 10).join(', ');
    parts.push(
      `${summary.unknown.length} member symbol(s) are not in instruments and will not appear in scans:\n  ${shown}${
        summary.unknown.length > 10 ? `, +${summary.unknown.length - 10} more` : ''
      }\n  Register them with nse_instrument_add, then nse_market_backfill.`,
    );
  }
  return parts.join('\n');
}

/** v2 plugin entry point — registers all tools via EthosPluginApi. */
export const plugin: EthosPlugin = {
  activate(api: EthosPluginApi) {
    for (const tool of createNseMarketDataTools()) {
      api.registerTool(tool);
    }
    // registerDataSource is new in plugin-sdk — guard until the type ships.
    (
      api as EthosPluginApi & { registerDataSource?(id: string, path: string): void }
    ).registerDataSource?.('market-db', getDbPath());
  },
};

/** Backward-compatible activate function for v1 hosts. */
export function activate(api: {
  registerTool(tool: Tool): void;
  registerDataSource?(id: string, path: string): void;
}): void {
  for (const tool of createNseMarketDataTools()) {
    api.registerTool(tool);
  }
  api.registerDataSource?.('market-db', getDbPath());
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
    nseFetchFiiDiiTool as Tool,
    nseGetCorporateActionsTool as Tool,
    nseGetBulkBlockTool as Tool,
    nseGetGiftNiftyTool as Tool,
    nseRefreshScansTool,
    nseMarketDashboardTool as Tool,
    nseMarketQueryTool as Tool,
    nseInstrumentAddTool as Tool,
  ];
  return tools;
}
