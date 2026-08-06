// Validation semantics for nse_instrument_add.
//
// The rule under test: only a definitive "no such symbol" blocks registration.
// Every other feed failure — including error shapes nobody has written yet —
// registers the row with a caveat. globalThis.fetch is stubbed; no network in CI.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@ethosagent/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketDataStore } from '../store';
import { createNseMarketDataTools } from '../tools';

function instrumentAddTool(): Tool<Record<string, unknown>> {
  const tool = createNseMarketDataTools().find((t) => t.name === 'nse_instrument_add');
  if (!tool) throw new Error('nse_instrument_add not registered');
  return tool as Tool<Record<string, unknown>>;
}

const ctx = {} as Parameters<Tool<Record<string, unknown>>['execute']>[1];

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function chartBody(opts: { name?: string; timestamps?: number[] } = {}): unknown {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            symbol: 'ZOMATO.NS',
            currency: 'INR',
            regularMarketPrice: 274.3,
            longName: opts.name ?? 'Zomato Limited',
            exchangeTimezoneName: 'Asia/Kolkata',
          },
          ...(opts.timestamps
            ? {
                timestamp: opts.timestamps,
                indicators: {
                  quote: [
                    {
                      open: opts.timestamps.map(() => 100),
                      high: opts.timestamps.map(() => 105),
                      low: opts.timestamps.map(() => 99),
                      close: opts.timestamps.map(() => 104),
                      volume: opts.timestamps.map(() => 1_000_000),
                    },
                  ],
                },
              }
            : { indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] } }),
        },
      ],
    },
  };
}

describe('nse_instrument_add validation', () => {
  let dir: string;
  let dbPath: string;
  let calls: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nse-add-'));
    dbPath = join(dir, 'market.db');
    process.env.NSE_MARKET_DATA_DB = dbPath;
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NSE_MARKET_DATA_DB;
    rmSync(dir, { recursive: true, force: true });
  });

  function stubFetch(handler: (url: string) => Response): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return handler(url);
      }),
    );
  }

  function withDb<T>(fn: (store: MarketDataStore) => T): T {
    const store = new MarketDataStore(dbPath);
    try {
      return fn(store);
    } finally {
      store.close();
    }
  }

  it('blocks on a definitive miss and writes nothing', async () => {
    stubFetch((url) =>
      url.includes('/search')
        ? jsonResponse(200, { quotes: [{ symbol: 'ZOMATO.NS', shortname: 'Zomato' }] })
        : jsonResponse(404, {}),
    );

    const result = await instrumentAddTool().execute({ symbol: 'ZOMAT0.NS' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_available');
    expect(result.error).toContain('ZOMATO.NS'); // suggestion from searchSymbol
    expect(withDb((s) => s.getInstrument('ZOMAT0.NS'))).toBeNull();
  });

  it('proceeds on a transient failure and flags the row as unconfirmed', async () => {
    stubFetch(() => jsonResponse(500, {}));

    const result = await instrumentAddTool().execute(
      { symbol: 'ZOMATO.NS', name: 'Zomato Limited' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('Could not confirm');
    expect(withDb((s) => s.getInstrument('ZOMATO.NS'))?.name).toBe('Zomato Limited');
  });

  it('proceeds on a fetch rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network unreachable');
      }),
    );

    const result = await instrumentAddTool().execute(
      { symbol: 'ZOMATO.NS', name: 'Zomato Limited' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('Could not confirm');
    expect(withDb((s) => s.getInstrument('ZOMATO.NS'))).not.toBeNull();
  });

  // Regression guard for "default the else branch to proceed": a failure mode
  // nobody has classified must not start silently blocking registrations.
  it('proceeds on an unrecognised feed error', async () => {
    stubFetch(() =>
      jsonResponse(200, {
        chart: { error: { code: 'Teapot', description: 'A brand new failure mode' }, result: null },
      }),
    );

    const result = await instrumentAddTool().execute(
      { symbol: 'ZOMATO.NS', name: 'Zomato Limited' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('A brand new failure mode');
    expect(withDb((s) => s.getInstrument('ZOMATO.NS'))).not.toBeNull();
  });

  it("blocks on Yahoo's delisted-symbol error", async () => {
    stubFetch((url) =>
      url.includes('/search')
        ? jsonResponse(200, { quotes: [] })
        : jsonResponse(200, {
            chart: {
              error: { code: 'Not Found', description: 'No data found, symbol may be delisted' },
              result: null,
            },
          }),
    );

    const result = await instrumentAddTool().execute(
      { symbol: 'NOPE.NS', name: 'Nope Limited' },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(withDb((s) => s.getInstrument('NOPE.NS'))).toBeNull();
  });

  it('reports an existing symbol without a feed call and without inserting', async () => {
    withDb((s) => s.addInstrument({ symbol: 'ZOMATO.NS', name: 'Zomato Limited' }));
    stubFetch(() => jsonResponse(200, chartBody()));

    const result = await instrumentAddTool().execute(
      { symbol: 'ZOMATO.NS', name: 'Something Else' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('already registered');
    expect(calls).toHaveLength(0);
    expect(withDb((s) => s.getInstrument('ZOMATO.NS'))?.name).toBe('Zomato Limited');
  });

  describe('feed call count (one call, not two)', () => {
    it('backfill omitted → one range=1d call, no windowed call', async () => {
      stubFetch(() => jsonResponse(200, chartBody()));
      await instrumentAddTool().execute({ symbol: 'ZOMATO.NS' }, ctx);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('range=1d');
    });

    it('backfill: true with name → only the windowed call', async () => {
      stubFetch(() => jsonResponse(200, chartBody({ timestamps: [1_700_000_000] })));
      await instrumentAddTool().execute(
        { symbol: 'ZOMATO.NS', name: 'Zomato Limited', backfill: true },
        ctx,
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('period1=');
      expect(calls[0]).not.toContain('range=1d');
    });

    it('backfill: true without name → both calls', async () => {
      stubFetch((url) =>
        jsonResponse(
          200,
          url.includes('range=1d') ? chartBody() : chartBody({ timestamps: [1_700_000_000] }),
        ),
      );
      await instrumentAddTool().execute({ symbol: 'ZOMATO.NS', backfill: true }, ctx);
      expect(calls).toHaveLength(2);
      expect(calls.filter((u) => u.includes('range=1d'))).toHaveLength(1);
    });
  });

  it('writes nothing when the backfill itself is a definitive miss', async () => {
    stubFetch((url) =>
      url.includes('/search') ? jsonResponse(200, { quotes: [] }) : jsonResponse(404, {}),
    );

    const result = await instrumentAddTool().execute(
      { symbol: 'NOPE.NS', name: 'Nope Limited', backfill: true },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(
      withDb((s) => ({
        instrument: s.getInstrument('NOPE.NS'),
        ohlcv: s.getSymbolCoverage('NOPE.NS').rows,
        syncMeta: s.query("SELECT COUNT(*) AS n FROM sync_meta WHERE symbol = 'NOPE.NS'", 1).rows[0]
          ?.n,
      })),
    ).toEqual({ instrument: null, ohlcv: 0, syncMeta: 0 });
  });

  it('treats zero backfilled rows as success, not as a bad symbol', async () => {
    stubFetch(() => jsonResponse(200, chartBody()));

    const result = await instrumentAddTool().execute(
      { symbol: 'FRESHIPO.NS', name: 'Fresh IPO Limited', backfill: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('Backfilled 0 rows');
    expect(withDb((s) => s.getInstrument('FRESHIPO.NS'))).not.toBeNull();
  });

  it('registers an index with constituents and names the unknown members', async () => {
    stubFetch(() => jsonResponse(200, chartBody({ name: 'Nifty Midcap 150' })));
    withDb((s) => s.addInstrument({ symbol: 'TCS.NS', name: 'Tata Consultancy Services' }));

    const result = await instrumentAddTool().execute(
      {
        symbol: '^NIFTYMIDCAP150',
        instrument_type: 'index',
        index_category: 'cap_segment',
        members: [{ symbol: 'TCS.NS', weight: 8.2 }, { symbol: 'KAYNES.NS' }],
        as_of_date: '2026-08-06',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('Attached 2 constituents');
    expect(result.value).toContain('KAYNES.NS');
    expect(withDb((s) => s.getIndexConstituents('^NIFTYMIDCAP150')).sort()).toEqual([
      'KAYNES.NS',
      'TCS.NS',
    ]);
  });

  it('rejects members on a non-index instrument', async () => {
    const result = await instrumentAddTool().execute(
      { symbol: 'ZOMATO.NS', name: 'Zomato Limited', members: [{ symbol: 'TCS.NS' }] },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('input_invalid');
    expect(calls).toHaveLength(0);
  });

  it('requires a name when validation is skipped', async () => {
    const result = await instrumentAddTool().execute({ symbol: 'ZOMATO.NS', validate: false }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('input_invalid');
    expect(calls).toHaveLength(0);
  });

  it('rejects a malformed symbol before touching the feed', async () => {
    const result = await instrumentAddTool().execute({ symbol: 'not a symbol!' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('input_invalid');
    expect(calls).toHaveLength(0);
  });
});
