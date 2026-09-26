import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bhavKeyForYahoo,
  extractCsvFromZip,
  fetchCmBhavcopy,
  isBhavcopySuffixed,
  lookupBhav,
  parseCmBhavcopy,
  seriesFamily,
} from '../bhavcopy';
import { configureNseArchive } from '../nse-archive';
import { bytesResponse, fixtureBytes } from './helpers/nse-mock';

// Real NSE CM bhavcopy of 25-09-2026 (deflate zip), trimmed to 13 rows across series.
const REAL_ZIP = fixtureBytes('bhavcopy', 'BhavCopy_NSE_CM_0_0_0_20260925_F_0000.csv.zip');

describe('CM bhavcopy parsing (real fixture)', () => {
  const day = parseCmBhavcopy(extractCsvFromZip(REAL_ZIP));

  it('inflates the real deflate zip and keeps every series', () => {
    const series = new Set([...day.values()].flat().map((r) => r.series));
    for (const s of ['EQ', 'BE', 'SM', 'ST', 'IV', 'RR', 'E1', 'GB'])
      expect(series.has(s)).toBe(true);
    expect(day.get('RELIANCE')?.[0]).toEqual({
      symbol: 'RELIANCE',
      series: 'EQ',
      open: 1210.5,
      high: 1227.4,
      low: 1210.5,
      close: 1226,
      volume: 13138735,
    });
  });

  it('maps Yahoo keys to bhavcopy keys (A3)', () => {
    expect(bhavKeyForYahoo('AAKAAR-SM.NS')).toBe('AAKAAR:SM');
    expect(bhavKeyForYahoo('NHIT-IV.NS')).toBe('NHIT:IV');
    expect(bhavKeyForYahoo('BAGMANE-RR.NS')).toBe('BAGMANE:RR');
    expect(bhavKeyForYahoo('ROCKPP-E1.NS')).toBe('ROCKPP:E1');
    expect(bhavKeyForYahoo('RELIANCE.NS')).toBe('RELIANCE:EQ');
    expect(bhavKeyForYahoo('ANANTAM.BO')).toBeNull();
    expect(bhavKeyForYahoo('^NSEI')).toBeNull();
    expect(isBhavcopySuffixed('AAKAAR-SM.NS')).toBe(true);
    expect(isBhavcopySuffixed('BAJAJ-AUTO.NS')).toBe(false);
  });

  it('looks up by series family: SM finds an ST row, EQ finds a BE row', () => {
    expect(seriesFamily('SM')).toEqual(['SM', 'ST']);
    expect(lookupBhav(day, 'AAKAAR:SM')?.series).toBe('SM');
    expect(lookupBhav(day, 'ACCPL:SM')?.series).toBe('ST'); // traded as ST that day
    expect(lookupBhav(day, 'FORCAS:SM')?.close).toBe(222);
    expect(lookupBhav(day, 'NHIT:IV')?.close).toBe(169.9);
    expect(lookupBhav(day, 'ABINFRA:EQ')?.series).toBe('BE');
    // A plain .NS key (SYM:EQ) falls back to any equity-like series, never a debt series.
    expect(lookupBhav(day, 'NHIT:EQ')?.series).toBe('IV');
    expect(lookupBhav(day, 'SGBJUN28:EQ')).toBeNull();
    expect(lookupBhav(day, 'NHIT:SM')).toBeNull(); // only EQ keys widen
    expect(lookupBhav(day, 'NOPE:EQ')).toBeNull();
  });
});

describe('fetchCmBhavcopy', () => {
  let dir: string;
  let calls: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nse-bhav-'));
    calls = [];
    configureNseArchive({ minIntervalMs: 0, retryDelaysMs: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return bytesResponse(200, REAL_ZIP);
      }),
    );
  });
  afterEach(() => {
    configureNseArchive();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('caches a compact copy and serves the second read without a request', async () => {
    const first = await fetchCmBhavcopy('2026-09-25', dir);
    const second = await fetchCmBhavcopy('2026-09-25', dir);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('BhavCopy_NSE_CM_0_0_0_20260925_F_0000.csv.zip');
    expect(second?.cached).toBe(true);
    expect(second?.data).toEqual(first?.data);
  });
});
