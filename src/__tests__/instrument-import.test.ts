// Add-only bulk import. The feed is faked — no network. The core guarantee under
// test: rows already in `instruments` are never deactivated or overwritten.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@ethosagent/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ImportCsvRow,
  type ImportFeed,
  importInstruments,
  parseCsv,
  readImportCsv,
  readImportReport,
  writeImportReport,
} from '../instrument-import';
import { configureNseArchive } from '../nse-archive';
import { MarketDataStore } from '../store';
import { createNseMarketDataTools } from '../tools';

const noSleep = async () => {};

/** Fake feed: known symbols return `bars` candles; `missing` ones 404; `flaky` ones 500. */
function fakeFeed(
  opts: { missing?: string[]; flaky?: string[]; bars?: number } = {},
): ImportFeed & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async quoteName(symbol) {
      calls.push(`quote:${symbol}`);
      return `${symbol} Feed Name`;
    },
    async backfill(store, symbol, fromDate) {
      calls.push(`backfill:${symbol}`);
      if (opts.missing?.includes(symbol)) throw new Error(`Symbol not found: ${symbol}`);
      if (opts.flaky?.includes(symbol)) throw new Error('Yahoo Finance error: 500');
      const bars = opts.bars ?? 3;
      store.insertOhlcv(
        Array.from({ length: bars }, (_, i) => ({
          symbol,
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          open: 10,
          high: 11,
          low: 9,
          close: 10.5,
          volume: 1000,
          adjClose: 10.5,
        })),
      );
      return { symbol, rowsInserted: bars, fromDate, toDate: '2026-01-31' };
    },
  };
}

const row = (symbol: string, description = `${symbol} Ltd`): ImportCsvRow => ({
  symbol,
  description,
  sector: 'Finance',
  industry: 'Banks',
});

describe('importInstruments', () => {
  let store: MarketDataStore;

  beforeEach(() => {
    store = new MarketDataStore(':memory:');
  });
  afterEach(() => store.close());

  it('skips registered symbols, adds and backfills new ones, and never inserts rejected ones', async () => {
    store.addInstrument({ symbol: 'OLD.NS', name: 'Old Name', sector: 'Old Sector', is_active: 1 });
    const feed = fakeFeed({ missing: ['GONE.NS'] });

    const { report, counts } = await importInstruments(
      store,
      [row('OLD', 'New Name'), row('NEW'), row('GONE')],
      { feed, sleep: noSleep },
    );

    expect(counts).toEqual({ exists: 1, added: 1, rejected: 1, error: 0 });
    expect(feed.calls).not.toContain('backfill:OLD.NS');
    expect(report.find((r) => r.csv_symbol === 'OLD')?.status).toBe('exists');

    const added = store.getInstrument('NEW.NS');
    expect(added).toMatchObject({
      name: 'NEW Ltd',
      sector: 'Finance',
      industry: 'Banks',
      exchange: 'NSE',
      instrument_type: 'equity',
      is_active: 1,
    });
    expect(store.getSymbolCoverage('NEW.NS').rows).toBe(3);
    expect(report.find((r) => r.csv_symbol === 'NEW')?.ohlcv_rows).toBe(3);

    expect(store.getInstrument('GONE.NS')).toBeNull();
    expect(report.find((r) => r.csv_symbol === 'GONE')?.status).toBe('rejected');
  });

  it('never deactivates or overwrites existing rows, including ones absent from the CSV', async () => {
    store.addInstrument({ symbol: 'OLD.NS', name: 'Old Name', sector: 'Old Sector', is_active: 1 });
    store.addInstrument({ symbol: 'NOTINCSV.NS', name: 'Keep Me', is_active: 1 });
    store.addInstrument({ symbol: 'DORMANT.NS', name: 'Dormant', is_active: 0 });
    const before = ['OLD.NS', 'NOTINCSV.NS', 'DORMANT.NS'].map((s) => store.getInstrument(s));

    await importInstruments(store, [row('OLD', 'Different'), row('DORMANT'), row('NEW')], {
      feed: fakeFeed(),
      sleep: noSleep,
    });

    const after = ['OLD.NS', 'NOTINCSV.NS', 'DORMANT.NS'].map((s) => store.getInstrument(s));
    expect(after).toEqual(before);
  });

  it('reports a transient feed failure as a retryable error and registers nothing', async () => {
    const { counts, report } = await importInstruments(store, [row('FLAKY')], {
      feed: fakeFeed({ flaky: ['FLAKY.NS'] }),
      sleep: noSleep,
    });
    expect(counts.error).toBe(1);
    expect(report[0]?.note).toContain('500');
    expect(store.getInstrument('FLAKY.NS')).toBeNull();
  });

  it('is resumable: carries forward added/rejected, retries errors', async () => {
    const first = await importInstruments(store, [row('A'), row('GONE'), row('FLAKY')], {
      feed: fakeFeed({ missing: ['GONE.NS'], flaky: ['FLAKY.NS'] }),
      sleep: noSleep,
    });
    const feed = fakeFeed();
    const second = await importInstruments(store, [row('A'), row('GONE'), row('FLAKY')], {
      feed,
      sleep: noSleep,
      previous: first.report,
    });

    expect(feed.calls).toEqual(['backfill:FLAKY.NS']);
    expect(second.counts).toEqual({ exists: 0, added: 2, rejected: 1, error: 0 });
  });

  it('batches with a delay between batches and honours limit', async () => {
    const sleeps: number[] = [];
    const { remaining, counts } = await importInstruments(
      store,
      ['A', 'B', 'C', 'D', 'E'].map((s) => row(s)),
      {
        feed: fakeFeed(),
        batchSize: 2,
        delayMs: 1234,
        limit: 4,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(sleeps).toEqual([1234]);
    expect(counts.added).toBe(4);
    expect(remaining).toBe(1);
  });

  it('looks the name up on the feed when Description is blank', async () => {
    const feed = fakeFeed();
    await importInstruments(store, [row('NONAME', '')], { feed, sleep: noSleep });
    expect(store.getInstrument('NONAME.NS')?.name).toBe('NONAME.NS Feed Name');
  });
});

describe('CSV helpers', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nse-import-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('parses quoted fields containing commas', () => {
    expect(parseCsv('a,"b, c",d\r\n"x ""y""",,z\n')).toEqual([
      ['a', 'b, c', 'd'],
      ['x "y"', '', 'z'],
    ]);
  });

  it('reads the stock CSV, upper-cases and dedupes symbols', () => {
    const p = join(dir, 'in.csv');
    writeFileSync(
      p,
      'Symbol,Description,Sector,Industry\nroute,"Route Mobile, Ltd.",Communications,Telecom\nROUTE,Dup,,\n',
    );
    expect(readImportCsv(p)).toEqual([
      {
        symbol: 'ROUTE',
        description: 'Route Mobile, Ltd.',
        sector: 'Communications',
        industry: 'Telecom',
      },
    ]);
  });

  it('round-trips the report', () => {
    const p = join(dir, 'report.csv');
    const report = [
      {
        csv_symbol: 'A',
        yahoo_symbol: 'A.NS',
        status: 'added' as const,
        ohlcv_rows: 250,
        note: 'x, y',
      },
    ];
    writeImportReport(p, report);
    expect(readFileSync(p, 'utf-8').split('\n')[0]).toBe(
      'csv_symbol,yahoo_symbol,status,ohlcv_rows,note',
    );
    expect(readImportReport(p)).toEqual(report);
  });
});

describe('nse_instrument_import tool', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nse-import-tool-'));
    process.env.NSE_MARKET_DATA_DB = join(dir, 'market.db');
    configureNseArchive({ minIntervalMs: 0, retryDelaysMs: [] });
  });
  afterEach(() => {
    configureNseArchive();
    vi.unstubAllGlobals();
    delete process.env.NSE_MARKET_DATA_DB;
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds new symbols through the real feed path and writes a report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const ok = url.includes('NEWCO.NS');
        return {
          status: ok ? 200 : 404,
          ok,
          json: async () => ({
            chart: {
              error: null,
              result: [
                {
                  meta: { symbol: 'NEWCO.NS', currency: 'INR', regularMarketPrice: 10 },
                  timestamp: [1_767_000_000],
                  indicators: {
                    quote: [{ open: [10], high: [11], low: [9], close: [10], volume: [100] }],
                  },
                },
              ],
            },
          }),
        } as Response;
      }),
    );
    const csv = join(dir, 'in.csv');
    const reportPath = join(dir, 'report.csv');
    writeFileSync(
      csv,
      'Symbol,Description,Sector,Industry\nNEWCO,New Co,Tech,Software\nBAD_SYM,Bad,,\n',
    );

    const tool = createNseMarketDataTools().find((t) => t.name === 'nse_instrument_import');
    if (!tool) throw new Error('nse_instrument_import not registered');
    const result = await (tool as Tool<Record<string, unknown>>).execute(
      { csv_path: csv, report_path: reportPath, delay_ms: 0 },
      {} as Parameters<Tool<Record<string, unknown>>['execute']>[1],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('1 added, 1 rejected');
    const report = readImportReport(reportPath);
    expect(report.map((r) => [r.csv_symbol, r.status])).toEqual([
      ['NEWCO', 'added'],
      ['BAD_SYM', 'rejected'],
    ]);
  });
});
