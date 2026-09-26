import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureNseArchive, NSE_HEADERS } from '../nse-archive';
import {
  deriveIndexKey,
  fetchIndexCloseRange,
  loadIndexCatalogue,
  normalizeIndexName,
  parseConstituents,
  parseIndexClose,
  suggestIndexNames,
} from '../nse-indices';
import { bytesResponse, dateFromUrl, fixture } from './helpers/nse-mock';

const FILE_2026 = fixture('nse-indices', 'ind_close_all_25092026.csv');
const FILE_2016 = fixture('nse-indices', 'ind_close_all_04012016.csv');

describe('parseIndexClose', () => {
  it('parses every row of the real 25-09-2026 file', () => {
    const day = parseIndexClose(FILE_2026);
    expect(day.size).toBe(166);
    const nifty = day.get('nifty 50');
    expect(nifty).toEqual({
      name: 'Nifty 50',
      date: '2026-09-25',
      open: 23035,
      high: 23162.7,
      low: 23020.95,
      close: 23140.5,
      volume: 242720711,
    });
  });

  it('turns the VIX "-" volume into 0', () => {
    const vix = parseIndexClose(FILE_2026).get('india vix');
    expect(vix?.volume).toBe(0);
    expect(vix?.close).toBe(12.16);
  });

  it('matches names across the 2016 case drift (D6)', () => {
    const old = parseIndexClose(FILE_2016);
    const now = parseIndexClose(FILE_2026);
    expect(old.get(normalizeIndexName('NIFTY Midcap 100'))?.name).toBe('Nifty Midcap 100');
    expect(now.get(normalizeIndexName('Nifty Midcap 100'))?.name).toBe('NIFTY Midcap 100');
  });

  it('throws on a header without the OHLC columns', () => {
    expect(() => parseIndexClose('Index Name,Index Date,Value\nNifty 50,25-09-2026,1\n')).toThrow(
      /header is missing/,
    );
  });
});

describe('index names and keys', () => {
  it('derives keys per D3', () => {
    expect(deriveIndexKey('Nifty Smallcap 50')).toBe('^NIFTYSMALLCAP50');
    expect(deriveIndexKey('Nifty Financial Services 25/50')).toBe('^NIFTYFINANCIALSERVICES2550');
  });

  it('suggests the closest names (D16)', () => {
    const names = [...parseIndexClose(FILE_2026).values()].map((r) => r.name);
    expect(suggestIndexNames('Nifty Smalcap 50', names)[0]).toBe('Nifty Smallcap 50');
  });

  it('catalogue: 38 unique indices, every name present in the real file', () => {
    const cat = loadIndexCatalogue();
    const day = parseIndexClose(FILE_2026);
    expect(cat).toHaveLength(38);
    expect(new Set(cat.map((c) => c.symbol)).size).toBe(38);
    for (const c of cat) expect(day.has(normalizeIndexName(c.nse_name))).toBe(true);
    expect(cat.find((c) => c.nse_name === 'NIFTY Midcap 100')?.symbol).toBe('^NSMIDCP100');
  });

  it('parses a real constituent list', () => {
    const rows = parseConstituents(fixture('nse-indices', 'ind_niftysmallcap50list.csv'));
    expect(rows).toHaveLength(50);
    expect(rows[0]?.symbol).toMatch(/\.NS$/);
  });
});

describe('fetchIndexCloseRange', () => {
  let calls: Array<{ url: string; headers: Record<string, string> }>;
  let dir: string;

  beforeEach(() => {
    calls = [];
    dir = mkdtempSync(join(tmpdir(), 'nse-idx-'));
    configureNseArchive({ minIntervalMs: 0, retryDelaysMs: [0, 0, 0] });
  });
  afterEach(() => {
    configureNseArchive();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  function stub(handler: (url: string) => Response): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        calls.push({ url, headers: init?.headers ?? {} });
        return handler(url);
      }),
    );
  }

  // 2026-09-21 (Mon) … 2026-09-25 (Fri)
  const FROM = '2026-09-19';
  const TO = '2026-09-25';

  it('skips a 404 day, sends the browser User-Agent, and serves a re-run from cache', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z')); // the 404 day is > 7 days old
    stub((url) =>
      dateFromUrl(url) === '2026-09-23'
        ? bytesResponse(404, 'not found')
        : bytesResponse(200, FILE_2026),
    );
    const r = await fetchIndexCloseRange(FROM, TO, dir);
    expect(r.days.map((d) => d.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-24',
      '2026-09-25',
    ]);
    expect(r.missingDates).toEqual(['2026-09-23']);
    expect(r.stoppedAt).toBeNull();
    expect(calls).toHaveLength(5); // weekends are never requested
    expect(calls[0]?.headers['User-Agent']).toBe(NSE_HEADERS['User-Agent']);
    expect(existsSync(join(dir, 'ind_close_all_21092026.csv'))).toBe(true);
    // An old 404 is remembered as a holiday.
    expect(existsSync(join(dir, 'ind_close_all_23092026.csv.404'))).toBe(true);

    calls = [];
    const again = await fetchIndexCloseRange(FROM, TO, dir);
    expect(calls).toHaveLength(0);
    expect(again.cachedDays).toBe(4);
    vi.useRealTimers();
  });

  it('does not remember a recent 404 — the file may still be published', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    stub(() => bytesResponse(404, 'not yet'));
    const r = await fetchIndexCloseRange('2026-09-25', '2026-09-25', dir);
    expect(r.missingDates).toEqual(['2026-09-25']);
    expect(existsSync(join(dir, 'ind_close_all_25092026.csv.404'))).toBe(false);
    vi.useRealTimers();
  });

  it('retries a 503 then stops the range at that day (D5), trying the fallback host', async () => {
    stub((url) =>
      dateFromUrl(url) === '2026-09-23'
        ? bytesResponse(503, 'busy')
        : bytesResponse(200, FILE_2026),
    );
    const r = await fetchIndexCloseRange(FROM, TO, null);
    expect(r.stoppedAt).toBe('2026-09-23');
    expect(r.stopReason).toContain('HTTP 503');
    expect(r.days.map((d) => d.date)).toEqual(['2026-09-21', '2026-09-22']);
    const failing = calls.filter((c) => dateFromUrl(c.url) === '2026-09-23');
    expect(failing).toHaveLength(8); // 4 attempts × 2 hosts
    expect(failing.some((c) => c.url.startsWith('https://archives.nseindia.com/'))).toBe(true);
  });
});
