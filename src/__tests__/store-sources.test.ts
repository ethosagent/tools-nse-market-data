// Price-source routing (plan nse-index-history A1–A7, D5/D6/D14–D16). No live network:
// globalThis.fetch is stubbed with recorded NSE files and synthetic Yahoo/bhavcopy bodies.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import _pkg from 'node-sqlite3-wasm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureNseArchive, weekdaysBetween } from '../nse-archive';
import { formatSyncSummary, type SyncProgress } from '../progress';
import { migrate } from '../schema';
import { explainLockError, IndexNotFoundError, MarketDataStore } from '../store';
import {
  bhavZip,
  bytesResponse,
  dateFromUrl,
  fixture,
  isoDaysAgo,
  yahooChart,
} from './helpers/nse-mock';

const { Database } = _pkg;
const FILE_2026 = fixture('nse-indices', 'ind_close_all_25092026.csv');
const SMALLCAP50_LIST = fixture('nse-indices', 'ind_niftysmallcap50list.csv');

type Net = {
  index?: (date: string) => Response;
  bhav?: (date: string) => Array<[string, string, number]> | Response;
  yahoo?: (symbol: string) => string[] | Response;
  constituents?: (slug: string) => string | null;
};

interface Calls {
  index: string[];
  bhav: string[];
  yahoo: string[];
  constituents: string[];
}

function stubNetwork(net: Net): Calls {
  const calls: Calls = { index: [], bhav: [], yahoo: [], constituents: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('ind_close_all_')) {
        const d = dateFromUrl(url) as string;
        calls.index.push(d);
        return net.index ? net.index(d) : bytesResponse(200, FILE_2026);
      }
      if (url.includes('BhavCopy_NSE_CM')) {
        const d = dateFromUrl(url) as string;
        calls.bhav.push(d);
        const r = net.bhav ? net.bhav(d) : [];
        return Array.isArray(r) ? bytesResponse(200, bhavZip(r)) : r;
      }
      const list = /content\/indices\/ind_(.+)list\.csv/.exec(url);
      if (list) {
        calls.constituents.push(list[1] as string);
        const body = net.constituents?.(list[1] as string) ?? null;
        return body === null ? bytesResponse(404, 'nf') : bytesResponse(200, body);
      }
      if (url.includes('finance.yahoo.com')) {
        const sym = decodeURIComponent(/chart\/([^?]+)/.exec(url)?.[1] ?? '');
        calls.yahoo.push(sym);
        const r = net.yahoo ? net.yahoo(sym) : [];
        return Array.isArray(r) ? bytesResponse(200, JSON.stringify(yahooChart(sym, r))) : r;
      }
      if (url.includes('nseindia.com')) return bytesResponse(404, 'nf');
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

/** Tests reach the private handle only to seed sync_meta / read raw rows. */
function db(store: MarketDataStore): InstanceType<typeof Database> {
  return (store as unknown as { db: InstanceType<typeof Database> }).db;
}

function all<T>(store: MarketDataStore, sql: string, params: unknown[] = []): T[] {
  const s = db(store).prepare(sql);
  const rows = s.all(params as never) as T[];
  s.finalize();
  return rows;
}

function setLastDate(store: MarketDataStore, symbol: string, date: string): void {
  const s = db(store).prepare(
    'INSERT OR REPLACE INTO sync_meta (symbol, last_sync, last_date) VALUES (?, 0, ?)',
  );
  s.run([symbol, date]);
  s.finalize();
}

function lastDate(store: MarketDataStore, symbol: string): string | null {
  return (
    all<{ last_date: string }>(store, 'SELECT last_date FROM sync_meta WHERE symbol = ?', [
      symbol,
    ])[0]?.last_date ?? null
  );
}

function bars(store: MarketDataStore, symbol: string): number {
  return (
    all<{ n: number }>(store, 'SELECT COUNT(*) AS n FROM ohlcv_daily WHERE symbol = ?', [symbol])[0]
      ?.n ?? 0
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function addIndex(store: MarketDataStore, symbol: string, nseName: string): void {
  store.addInstrument({
    symbol,
    name: nseName,
    instrument_type: 'index',
    index_category: 'broad',
    price_source: 'nse_index',
    source_key: nseName,
  });
}

beforeEach(() => configureNseArchive({ minIntervalMs: 0, retryDelaysMs: [0, 0, 0] }));
afterEach(() => {
  configureNseArchive();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('A7 first-install migration', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nse-mig-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('routes existing rows, registers the catalogue indices, and runs once', () => {
    const path = join(dir, 'market.db');
    const raw = new Database(path);
    migrate(raw);
    const ins = raw.prepare(
      'INSERT INTO instruments (symbol, name, added_at, instrument_type) VALUES (?, ?, 0, ?)',
    );
    for (const [s, n, t] of [
      ['^NSEI', 'NIFTY 50', 'index'],
      ['^CNXAUTO', 'NIFTY Auto', 'index'],
      ['AAKAAR-SM.NS', 'Aakaar', 'equity'],
      ['NHIT-IV.NS', 'NHIT', 'equity'],
      ['ROCKPP-E1.NS', 'Rockingdeals', 'equity'],
      ['RELIANCE.NS', 'Reliance', 'equity'],
      ['ANANTAM.BO', 'Anantam', 'equity'],
    ]) {
      ins.run([s, n, t] as never);
    }
    ins.finalize();
    raw.close();

    let store = new MarketDataStore(path, { cacheDir: null });
    const src = new Map(
      all<{ symbol: string; price_source: string; source_key: string }>(
        store,
        'SELECT symbol, price_source, source_key FROM instruments',
      ).map((r) => [r.symbol, `${r.price_source}|${r.source_key}`]),
    );
    expect(src.get('^NSEI')).toBe('nse_index|Nifty 50');
    expect(src.get('^CNXAUTO')).toBe('nse_index|Nifty Auto');
    expect(src.get('AAKAAR-SM.NS')).toBe('bhavcopy|AAKAAR:SM');
    expect(src.get('NHIT-IV.NS')).toBe('bhavcopy|NHIT:IV');
    expect(src.get('ROCKPP-E1.NS')).toBe('bhavcopy|ROCKPP:E1');
    expect(src.get('RELIANCE.NS')).toBe('yahoo|RELIANCE.NS');
    expect(src.get('ANANTAM.BO')).toBe('yahoo|ANANTAM.BO');
    expect(src.get('^NIFTYSMALLCAP50')).toBe('nse_index|Nifty Smallcap 50');
    expect(src.get('^NSMIDCP100')).toBe('nse_index|NIFTY Midcap 100');
    expect(
      all<{ n: number }>(
        store,
        "SELECT COUNT(*) AS n FROM instruments WHERE instrument_type = 'index'",
      )[0]?.n,
    ).toBe(38);

    // A row added after the migration stays unresolved until a backfill resolves it.
    store.addInstrument({ symbol: 'NEWCO.NS', name: 'New Co' });
    store.close();
    store = new MarketDataStore(path, { cacheDir: null });
    expect(store.getInstrument('NEWCO.NS')?.price_source).toBeNull();
    expect(
      all<{ n: number }>(store, 'SELECT COUNT(*) AS n FROM schema_version WHERE version = 37')[0]
        ?.n,
    ).toBe(1);
    store.close();
  });

  it('registers nothing on a blank DB', () => {
    const store = new MarketDataStore(':memory:');
    expect(store.listInstrumentSymbols()).toEqual([]);
    store.close();
  });

  it('a seed re-upsert without a source does not null the stored one (A1)', () => {
    const store = new MarketDataStore(':memory:');
    store.addInstrument({
      symbol: 'AAKAAR-SM.NS',
      name: 'Aakaar',
      price_source: 'bhavcopy',
      source_key: 'AAKAAR:SM',
    });
    store.upsertInstruments([{ symbol: 'AAKAAR-SM.NS', name: 'Aakaar Medical' }]);
    const row = store.getInstrument('AAKAAR-SM.NS');
    expect(row?.name).toBe('Aakaar Medical');
    expect(row?.price_source).toBe('bhavcopy');
    expect(row?.source_key).toBe('AAKAAR:SM');
    store.upsertInstruments([
      {
        symbol: 'AAKAAR-SM.NS',
        name: 'Aakaar Medical',
        price_source: 'yahoo',
        source_key: 'AAKAAR-SM.NS',
      },
    ]);
    expect(store.getInstrument('AAKAAR-SM.NS')?.price_source).toBe('yahoo');
    store.close();
  });
});

// ---------------------------------------------------------------------------

describe('update groups by source (A5)', () => {
  let store: MarketDataStore;
  const since = isoDaysAgo(8);
  const window = () => weekdaysBetween(isoDaysAgo(7), today());

  beforeEach(() => {
    store = new MarketDataStore(':memory:');
    addIndex(store, '^NSEI', 'Nifty 50');
    addIndex(store, '^CNXAUTO', 'Nifty Auto');
    addIndex(store, '^NIFTYSMALLCAP50', 'Nifty Smallcap 50');
    store.addInstrument({
      symbol: 'AAKAAR-SM.NS',
      name: 'Aakaar',
      price_source: 'bhavcopy',
      source_key: 'AAKAAR:SM',
    });
    store.addInstrument({
      symbol: 'RELIANCE.NS',
      name: 'Reliance',
      price_source: 'yahoo',
      source_key: 'RELIANCE.NS',
    });
    for (const s of ['^NSEI', '^CNXAUTO', '^NIFTYSMALLCAP50', 'AAKAAR-SM.NS', 'RELIANCE.NS']) {
      setLastDate(store, s, since);
    }
  });
  afterEach(() => store.close());

  it("source 'yahoo': one NSE file and one bhavcopy per day, one Yahoo call per Yahoo symbol", async () => {
    const calls = stubNetwork({
      bhav: () => [
        ['AAKAAR', 'ST', 70],
        ['RELIANCE', 'EQ', 1226],
      ],
      yahoo: () => window(),
    });
    const events: SyncProgress[] = [];
    const s = await store.updateAll((e) => events.push(e), { source: 'yahoo' });
    const days = window();

    expect(calls.index).toEqual(days);
    const first = days[0] as string;
    expect(calls.bhav.filter((d) => d >= first)).toEqual(days); // plus the 10-day fill lookback
    expect(new Set(calls.bhav).size).toBe(calls.bhav.length);
    expect(calls.yahoo).toEqual(['RELIANCE.NS']);
    expect(events[0]).toMatchObject({
      kind: 'start',
      op: 'update',
      total: 5,
      bySource: { nse_index: 3, bhavcopy: 1, yahoo: 1, resolve: 0 },
      preference: 'yahoo',
    });
    expect(events.filter((e) => e.kind === 'symbols').at(-1)).toMatchObject({ done: 5, total: 5 });

    expect(bars(store, '^NSEI')).toBe(days.length);
    expect(
      all<{ volume: number }>(
        store,
        "SELECT volume FROM ohlcv_daily WHERE symbol = '^NSEI' LIMIT 1",
      )[0]?.volume,
    ).toBe(242720711);
    expect(bars(store, 'AAKAAR-SM.NS')).toBe(days.length); // SM key matched the ST rows
    expect(bars(store, 'RELIANCE.NS')).toBe(days.length);
    expect(lastDate(store, '^NSEI')).toBe(days.at(-1));
    expect(s.failed).toEqual([]);
    expect(s.filledDays).toBe(0);
    expect(s.bySource.nse_index).toEqual({ symbols: 3, rows: 3 * days.length });
  });

  it('a failing day stops the index range there; last_date holds the day before (D5)', async () => {
    const days = window();
    const bad = days[2] as string;
    stubNetwork({
      index: (d) => (d === bad ? bytesResponse(503, 'busy') : bytesResponse(200, FILE_2026)),
      yahoo: () => days,
    });
    const s = await store.updateAll();
    expect(bars(store, '^NSEI')).toBe(2);
    expect(lastDate(store, '^NSEI')).toBe(days[1]);
    expect(s.notes.join('\n')).toContain(`NSE index file: stopped at ${bad}`);
  });

  it('an index missing from a valid file is reported and not advanced (D6)', async () => {
    addIndex(store, '^GHOST', 'Nifty Imaginary 7');
    setLastDate(store, '^GHOST', since);
    stubNetwork({ yahoo: () => window() });
    const s = await store.updateAll();
    expect(s.failed).toEqual([
      expect.objectContaining({
        symbol: '^GHOST',
        source: 'nse_index',
        reason: expect.stringContaining('missing from the NSE index file'),
      }),
    ]);
    expect(lastDate(store, '^GHOST')).toBe(since);
    expect(bars(store, '^NSEI')).toBe(window().length);
  });

  it('fills a Yahoo miss from the bhavcopy without switching (A4 per-day fill)', async () => {
    const days = window();
    const missing = days.at(-1) as string;
    stubNetwork({
      bhav: () => [['RELIANCE', 'EQ', 1226]],
      yahoo: () => days.filter((d) => d !== missing),
    });
    const s = await store.updateAll(undefined, { source: 'yahoo' });
    expect(s.filledDays).toBe(1);
    expect(s.switches).toEqual([]);
    expect(bars(store, 'RELIANCE.NS')).toBe(days.length);
    expect(store.getInstrument('RELIANCE.NS')?.price_source).toBe('yahoo');
    expect(
      all<{ yahoo_miss_streak: number }>(
        store,
        "SELECT yahoo_miss_streak FROM sync_meta WHERE symbol = 'RELIANCE.NS'",
      )[0]?.yahoo_miss_streak,
    ).toBe(1);
  });

  it('switches a Yahoo symbol to the bhavcopy after 3+ consecutive missed days (A4)', async () => {
    stubNetwork({ bhav: () => [['RELIANCE', 'BE', 1226]], yahoo: () => [] });
    const s = await store.updateAll(undefined, { source: 'yahoo' });
    const days = window();
    expect(days.length).toBeGreaterThanOrEqual(3);
    expect(s.switches).toEqual([
      expect.objectContaining({
        symbol: 'RELIANCE.NS',
        from: 'yahoo',
        to: 'bhavcopy',
        key: 'RELIANCE:BE',
      }),
    ]);
    expect(store.getInstrument('RELIANCE.NS')).toMatchObject({
      price_source: 'bhavcopy',
      source_key: 'RELIANCE:BE',
    });
    expect(all<{ to_source: string }>(store, 'SELECT to_source FROM source_switches')).toEqual([
      { to_source: 'bhavcopy' },
    ]);
    expect(bars(store, 'RELIANCE.NS')).toBe(days.length); // every missed day was filled
  });
});

// ---------------------------------------------------------------------------

describe('A11 source preference', () => {
  let store: MarketDataStore;
  const since = isoDaysAgo(8);
  const window = () => weekdaysBetween(isoDaysAgo(7), today());
  const EQ = ['RELIANCE.NS', 'TCS.NS', 'ABINFRA.NS'];

  beforeEach(() => {
    store = new MarketDataStore(':memory:');
    addIndex(store, '^NSEI', 'Nifty 50');
    addIndex(store, '^CNXAUTO', 'Nifty Auto');
    for (const sym of EQ) {
      store.addInstrument({ symbol: sym, name: sym, price_source: 'yahoo', source_key: sym });
    }
    store.addInstrument({
      symbol: 'AAKAAR-SM.NS',
      name: 'Aakaar',
      price_source: 'bhavcopy',
      source_key: 'AAKAAR:SM',
    });
    store.addInstrument({
      symbol: 'ANANTAM.BO',
      name: 'Anantam',
      price_source: 'yahoo',
      source_key: 'ANANTAM.BO',
    });
    for (const sym of ['^NSEI', '^CNXAUTO', ...EQ, 'AAKAAR-SM.NS', 'ANANTAM.BO']) {
      setLastDate(store, sym, since);
    }
  });
  afterEach(() => store.close());

  // ABINFRA trades as BE: a plain .NS key matches the whole main-board family.
  const bhavDay = (): Array<[string, string, number]> => [
    ['RELIANCE', 'EQ', 1226],
    ['TCS', 'EQ', 2082],
    ['ABINFRA', 'BE', 12.58],
    ['AAKAAR', 'SM', 70],
    ['SGBJUN28', 'GB', 15040],
  ];

  it('default: 1 bhavcopy + 1 index file per day, Yahoo only for the .BO', async () => {
    const calls = stubNetwork({ bhav: bhavDay, yahoo: () => window() });
    const events: SyncProgress[] = [];
    const s = await store.updateWatchlist(undefined); // empty watchlist: nothing
    expect(s.total).toBe(0);
    const summary = await store.updateAll((e) => events.push(e));
    const days = window();

    expect(calls.index).toEqual(days);
    expect(calls.bhav).toEqual(days);
    expect(calls.yahoo).toEqual(['ANANTAM.BO']);
    expect(events[0]).toMatchObject({
      kind: 'start',
      bySource: { nse_index: 2, bhavcopy: 4, yahoo: 1, resolve: 0 },
      preference: 'bhavcopy',
    });
    for (const sym of [...EQ, 'AAKAAR-SM.NS', 'ANANTAM.BO', '^NSEI']) {
      expect(bars(store, sym)).toBe(days.length);
    }
    // Stored sources are untouched by the preference.
    expect(store.getInstrument('RELIANCE.NS')?.price_source).toBe('yahoo');
    // Bhavcopy rows are raw: adj_close = close.
    expect(
      all<{ close: number; adj_close: number }>(
        store,
        "SELECT close, adj_close FROM ohlcv_daily WHERE symbol = 'TCS.NS' LIMIT 1",
      )[0],
    ).toEqual({ close: 2082, adj_close: 2082 });
    expect(summary.bySource.bhavcopy.symbols).toBe(4);
    expect(summary.bySource.yahoo.symbols).toBe(1);
    expect(summary.fallbacks).toEqual([
      { to: 'yahoo', reason: 'no NSE bhavcopy key (BSE symbol)', symbols: ['ANANTAM.BO'] },
    ]);
    expect(formatSyncSummary(summary)).toContain(
      '1 via Yahoo: no NSE bhavcopy key (BSE symbol) (ANANTAM.BO).',
    );
  });

  it('default: a stock the bhavcopy does not list falls back to Yahoo, named in the summary', async () => {
    const calls = stubNetwork({
      bhav: () => bhavDay().filter(([sym]) => sym !== 'TCS'),
      yahoo: () => window(),
    });
    const s = await store.updateAll();
    expect(calls.yahoo.sort()).toEqual(['ANANTAM.BO', 'TCS.NS']);
    expect(s.fallbacks).toContainEqual({
      to: 'yahoo',
      reason: 'not in the bhavcopy',
      symbols: ['TCS.NS'],
    });
    expect(bars(store, 'TCS.NS')).toBe(window().length);
  });

  it("source 'yahoo': Yahoo for the EQs, the SM symbol stays on the bhavcopy", async () => {
    const calls = stubNetwork({ bhav: bhavDay, yahoo: () => window() });
    const s = await store.updateAll(undefined, { source: 'yahoo' });
    expect(calls.yahoo.sort()).toEqual(['ABINFRA.NS', 'ANANTAM.BO', 'RELIANCE.NS', 'TCS.NS']);
    expect(bars(store, 'AAKAAR-SM.NS')).toBe(window().length);
    expect(
      all<{ close: number }>(
        store,
        "SELECT close FROM ohlcv_daily WHERE symbol = 'TCS.NS' LIMIT 1",
      )[0]?.close,
    ).toBe(100); // Yahoo's price, not the bhavcopy's
    expect(s.fallbacks).toEqual([
      { to: 'bhavcopy', reason: 'no Yahoo data (bhavcopy-sourced)', symbols: ['AAKAAR-SM.NS'] },
    ]);
  });

  it('no new session: zero Yahoo calls, only the NSE file probes', async () => {
    const last = window().at(-1) as string; // everything already synced to the latest weekday
    for (const sym of ['^NSEI', '^CNXAUTO', ...EQ, 'AAKAAR-SM.NS', 'ANANTAM.BO']) {
      setLastDate(store, sym, last);
    }
    const calls = stubNetwork({
      index: () => bytesResponse(404, 'nf'),
      bhav: () => bytesResponse(404, 'nf'),
      yahoo: () => window(),
    });
    const s = await store.updateWatchlist();
    expect(s.total).toBe(0);
    store.watchlistAdd('ANANTAM.BO');
    store.watchlistAdd('TCS.NS');
    const summary = await store.updateWatchlist();
    expect(calls.yahoo).toEqual([]);
    expect(calls.constituents).toEqual([]);
    // Only the days after last_date up to today were probed (none on a Friday-to-Friday run).
    expect(calls.bhav.every((d) => d > last)).toBe(true);
    if (last < today()) {
      expect(summary.notes.join('\n')).toContain(`No new trading day since ${last}`);
    }
    expect(summary.failed).toEqual([]);
  });
});

describe('backfill resolves an unrouted symbol once (A2)', () => {
  it('Yahoo with real history → yahoo; thin Yahoo + bhavcopy → bhavcopy; neither → refused; BSE partial → yahoo', async () => {
    const store = new MarketDataStore(':memory:');
    for (const s of ['GOOD.NS', 'AAKAAR-SM.NS', 'NOPE.NS', 'PART.BO']) {
      store.addInstrument({ symbol: s, name: s });
    }
    const from = isoDaysAgo(30);
    const days = weekdaysBetween(from, today());
    const calls = stubNetwork({
      yahoo: (sym) => {
        if (sym === 'GOOD.NS') return days;
        if (sym === 'NOPE.NS') return bytesResponse(404, '{}');
        return days.slice(-1); // one bar: far below 50 %
      },
      bhav: () => [['AAKAAR', 'ST', 70]],
    });
    const s = await store.backfillAll(
      ['GOOD.NS', 'AAKAAR-SM.NS', 'NOPE.NS', 'PART.BO'],
      from,
      undefined,
      {
        source: 'yahoo',
      },
    );

    expect(store.getInstrument('GOOD.NS')).toMatchObject({
      price_source: 'yahoo',
      source_key: 'GOOD.NS',
    });
    expect(store.getInstrument('AAKAAR-SM.NS')).toMatchObject({
      price_source: 'bhavcopy',
      source_key: 'AAKAAR:ST',
    });
    expect(bars(store, 'AAKAAR-SM.NS')).toBe(days.length); // Yahoo's single bar was not kept
    expect(store.getInstrument('NOPE.NS')?.price_source).toBeNull();
    expect(bars(store, 'NOPE.NS')).toBe(0);
    expect(s.failed).toEqual([
      expect.objectContaining({
        symbol: 'NOPE.NS',
        source: 'unresolved',
        reason: expect.stringMatching(
          /Symbol not found: NOPE\.NS; NOPE:EQ is not in the NSE CM bhavcopy/,
        ),
      }),
    ]);
    expect(store.getInstrument('PART.BO')?.price_source).toBe('yahoo');
    expect(s.resolved.find((r) => r.symbol === 'PART.BO')?.partial).toBe(true);
    expect(new Set(calls.bhav).size).toBe(calls.bhav.length); // one pass for all candidates

    // Resolved once: a second backfill routes AAKAAR straight to the bhavcopy, no Yahoo call.
    calls.yahoo.length = 0;
    await store.backfillAll(['AAKAAR-SM.NS'], from, undefined, { source: 'yahoo' });
    expect(calls.yahoo).toEqual([]);
    store.close();
  });

  it('backfillSymbol throws the refusal so callers can tell a definitive miss', async () => {
    const store = new MarketDataStore(':memory:');
    stubNetwork({ yahoo: () => bytesResponse(404, '{}') });
    await expect(store.backfillSymbol('NOPE.NS', isoDaysAgo(10))).rejects.toThrow(
      /Symbol not found: NOPE\.NS/,
    );
    store.close();
  });
});

// ---------------------------------------------------------------------------

describe('NSE indices by name and constituents (D14–D16)', () => {
  let store: MarketDataStore;
  beforeEach(() => {
    store = new MarketDataStore(':memory:');
  });
  afterEach(() => store.close());

  it('adds by NSE name with the D3 key, backfills from the NSE file, attaches members', async () => {
    const calls = stubNetwork({
      constituents: (slug) => (slug === 'niftysmallcap50' ? SMALLCAP50_LIST : null),
    });
    const r = await store.addIndexByName('nifty smallcap 50', { from: isoDaysAgo(10) });
    expect(r.symbol).toBe('^NIFTYSMALLCAP50');
    expect(r.nseName).toBe('Nifty Smallcap 50');
    expect(r.status).toBe('created');
    expect(bars(store, '^NIFTYSMALLCAP50')).toBe(weekdaysBetween(isoDaysAgo(10), today()).length);
    expect(r.constituents).toMatchObject({ status: 'replaced', members: 50 });
    expect(r.constituents?.unknown).toHaveLength(50); // none registered in this DB
    expect(store.getIndexConstituents('^NIFTYSMALLCAP50')).toHaveLength(50);
    expect(calls.constituents).toEqual(['niftysmallcap50']);

    const mid = await store.addIndexByName('NIFTY Midcap 100', { from: isoDaysAgo(5) });
    expect(mid.symbol).toBe('^NSMIDCP100');
  });

  it('refuses a misspelt name with the closest names', async () => {
    stubNetwork({});
    const err = await store.addIndexByName('Nifty Smalcap 50').catch((e) => e);
    expect(err).toBeInstanceOf(IndexNotFoundError);
    expect((err as IndexNotFoundError).suggestions[0]).toBe('Nifty Smallcap 50');
  });

  it('refuses a key that is already used by something else', async () => {
    stubNetwork({});
    store.addInstrument({
      symbol: '^NIFTYMEDIA',
      name: 'Something else',
      price_source: 'yahoo',
      source_key: '^NIFTYMEDIA',
    });
    await expect(store.addIndexByName('Nifty Media', { from: isoDaysAgo(5) })).rejects.toThrow(
      /already registered/,
    );
  });

  it('replace drops removed members; refresh skips fresh lists and re-fetches stale ones', async () => {
    addIndex(store, '^NIFTYSMALLCAP50', 'Nifty Smallcap 50');
    store.upsertIndexConstituents([
      { index_symbol: '^NIFTYSMALLCAP50', member_symbol: 'GONE.NS', as_of_date: isoDaysAgo(40) },
    ]);
    const calls = stubNetwork({ constituents: () => SMALLCAP50_LIST });
    const [stale] = await store.refreshIndexConstituents(['^NIFTYSMALLCAP50'], { staleDays: 30 });
    expect(stale?.status).toBe('replaced');
    expect(store.getIndexConstituents('^NIFTYSMALLCAP50')).not.toContain('GONE.NS');
    expect(calls.constituents).toHaveLength(1);

    const [fresh] = await store.refreshIndexConstituents(['^NIFTYSMALLCAP50'], { staleDays: 30 });
    expect(fresh?.status).toBe('skipped');
    expect(calls.constituents).toHaveLength(1);

    addIndex(store, '^NIFTYCHEMICALS', 'Nifty Chemicals');
    const [none] = await store.refreshIndexConstituents(['^NIFTYCHEMICALS']);
    expect(none).toMatchObject({ status: 'skipped', reason: 'no constituent file' });
    expect(calls.constituents).toHaveLength(1); // catalogue says no file: no request
  });
});

// ---------------------------------------------------------------------------

describe('lock error names the lock directory (T9)', () => {
  it('explains "database is locked" and keeps the original text', () => {
    const e = explainLockError(new Error('database is locked'), '/x/market.db') as Error;
    expect(e.message).toContain('database is locked');
    expect(e.message).toContain('/x/market.db.lock');
    expect(explainLockError(new Error('other'), '/x/market.db')).toEqual(new Error('other'));
  });

  it('a locked write through the store carries the lock path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nse-lock-'));
    const path = join(dir, 'market.db');
    const store = new MarketDataStore(path, { cacheDir: null });
    const handle = db(store);
    const realExec = handle.exec.bind(handle);
    handle.exec = ((sql: string) => {
      if (sql === 'BEGIN') throw new Error('database is locked');
      return realExec(sql);
    }) as typeof handle.exec;
    expect(() =>
      store.insertOhlcv([
        {
          symbol: 'A.NS',
          date: '2026-09-25',
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
          adjClose: null,
        },
      ]),
    ).toThrow(`${path}.lock`);
    handle.exec = realExec as typeof handle.exec;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
