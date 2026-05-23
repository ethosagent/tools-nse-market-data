// Ethos Tool wrappers around MarketDataStore
// Implemented per Section 14 of tools-nse-market-data.md
// @ethosagent/types is an optional peer dep — types re-declared locally to avoid hard import

// ---------------------------------------------------------------------------
// Local type re-declarations (mirrors @ethosagent/types Tool interface)
// ---------------------------------------------------------------------------

type ToolResult = { ok: true; value: string } | { ok: false; error: string; code: string };

interface ToolContext {
  abortSignal?: AbortSignal;
  secretsResolver?: { get(ref: string): Promise<string | null> };
  scopedFetch?: { fetch(url: string, init?: RequestInit): Promise<Response> };
  emit?: (event: {
    type: 'progress';
    toolName: string;
    message: string;
    audience?: 'user' | 'internal';
    percent?: number;
  }) => void;
}

interface Tool<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  toolset: string;
  maxResultChars?: number;
  outputIsUntrusted?: boolean;
  capabilities?: {
    network?: { allowedHosts: string[] };
    secrets?: string[];
    fs?: { read?: string[]; write?: string[] };
  };
  isAvailable?(): boolean;
  schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------

import { homedir } from 'node:os';
import { join } from 'node:path';
import { MarketDataStore } from './store';

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

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const nseMarketCleanTool: Tool = {
  name: 'nse_market_clean',
  description:
    'Delete all market data from the local SQLite database. Use before a fresh backfill.',
  toolset: 'market',
  capabilities: {},
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
    'Download 1 year of daily OHLCV history for NSE stocks and store locally. One-time operation. Shows progress.',
  toolset: 'market',
  maxResultChars: 5000,
  capabilities: {
    network: { allowedHosts: ['query1.finance.yahoo.com'] },
  },
  schema: {
    type: 'object',
    properties: {
      symbols: {
        type: 'string',
        description:
          'Comma-separated NSE symbols (e.g. RELIANCE.NS,TCS.NS). Defaults to watchlist.',
      },
      from_date: {
        type: 'string',
        description: 'Start date YYYY-MM-DD. Defaults to 1 year ago.',
      },
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const store = getStore();
    const fromDate =
      args.from_date ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let symbols: string[];
    if (args.symbols) {
      symbols = args.symbols
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      const watchlist = store.watchlistList();
      symbols = watchlist.map((e) => e.symbol);
      if (symbols.length === 0) {
        return {
          ok: false,
          error:
            'No symbols provided and watchlist is empty. Add symbols with nse_watchlist_add first.',
          code: 'no_symbols',
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
        code: 'no_data',
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

export function createNseMarketDataTools(): Tool[] {
  return [
    nseMarketCleanTool,
    nseMarketBackfillTool,
    nseMarketUpdateTool,
    nseWatchlistAddTool as unknown as Tool,
    nseWatchlistRemoveTool as unknown as Tool,
    nseWatchlistShowTool as unknown as Tool,
    nseMarketHistoryTool as unknown as Tool,
    nseMarketScreenTool as unknown as Tool,
  ];
}
