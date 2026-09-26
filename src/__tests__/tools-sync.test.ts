// Tool surface for the sync work (plan nse-index-history A6, A11, D15). No live network.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@ethosagent/types';
import _pkg from 'node-sqlite3-wasm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureNseArchive } from '../nse-archive';
import { MarketDataStore } from '../store';
import { createNseMarketDataTools } from '../tools';
import { bhavZip, bytesResponse, dateFromUrl, fixture, isoDaysAgo } from './helpers/nse-mock';

const { Database } = _pkg;

function tool(name: string): Tool<Record<string, unknown>> {
  const t = createNseMarketDataTools().find((x) => x.name === name);
  if (!t) throw new Error(`${name} not registered`);
  return t as Tool<Record<string, unknown>>;
}

describe('sync tools', () => {
  let dir: string;
  let events: Array<{ message: string; audience?: string; percent?: number }>;
  let ctx: Parameters<Tool<Record<string, unknown>>['execute']>[1];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nse-tools-'));
    process.env.NSE_MARKET_DATA_DB = join(dir, 'market.db');
    configureNseArchive({ minIntervalMs: 0, retryDelaysMs: [] });
    events = [];
    ctx = { emit: (e: (typeof events)[number]) => events.push(e) } as unknown as typeof ctx;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('ind_close_all_'))
          return bytesResponse(200, fixture('nse-indices', 'ind_close_all_25092026.csv'));
        if (url.includes('BhavCopy_NSE_CM') && dateFromUrl(url)) {
          return bytesResponse(
            200,
            bhavZip(Array.from({ length: 60 }, (_, i) => [`STK${i}`, 'EQ', 100 + i])),
          );
        }
        return bytesResponse(404, 'nf');
      }),
    );
  });
  afterEach(() => {
    configureNseArchive();
    vi.unstubAllGlobals();
    delete process.env.NSE_MARKET_DATA_DB;
    rmSync(dir, { recursive: true, force: true });
  });

  it('nse_market_update streams throttled user-facing progress and returns a short summary', async () => {
    const store = new MarketDataStore(join(dir, 'market.db'));
    for (let i = 0; i < 60; i++) {
      store.addInstrument({
        symbol: `STK${i}.NS`,
        name: `Stock ${i}`,
        price_source: 'yahoo',
        source_key: `STK${i}.NS`,
      });
      store.insertOhlcv([
        {
          symbol: `STK${i}.NS`,
          date: isoDaysAgo(8),
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
          adjClose: 1,
        },
      ]);
      store.watchlistAdd(`STK${i}.NS`);
    }
    store.close();
    // Synced up to 8 days ago, so the window is about a week of files.
    const raw = new Database(join(dir, 'market.db'));
    const ins = raw.prepare(
      'INSERT INTO sync_meta (symbol, last_sync, last_date) VALUES (?, 0, ?)',
    );
    for (let i = 0; i < 60; i++) ins.run([`STK${i}.NS`, isoDaysAgo(8)]);
    ins.finalize();
    raw.close();

    const result = await tool('nse_market_update').execute({ mode: 'watchlist' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(events[0]?.message).toBe('Updating 60 symbols (prefer NSE bhavcopy): 60 via bhavcopy');
    expect(events.every((e) => e.audience === 'user')).toBe(true);
    const symbolLines = events.filter((e) => /^\d+\/60 /.test(e.message));
    expect(symbolLines.length).toBeLessThan(60); // throttled, not one per symbol
    expect(symbolLines.at(-1)?.message).toMatch(/^60\/60 \(100%\)/);
    expect(result.value.split('\n')[0]).toMatch(
      /^Update complete: 60 symbols in \d+s — 60 ok, 0 failed\.$/,
    );
    expect(result.value.split('\n').length).toBeLessThan(10);
  });

  it('nse_index_add refuses an unknown name with suggestions', async () => {
    const result = await tool('nse_index_add').execute({ name: 'Nifty Smalcap 50' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_available');
    expect(result.error).toContain('"Nifty Smallcap 50"');
  });
});
