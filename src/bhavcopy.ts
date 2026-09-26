// NSE CM Bhavcopy — one zip per trading day covering every NSE cash-market security.
// Current (UDiFF) format, available from 2024-01:
//   https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip
// Old format, the only one for dates before 2024:
//   https://nsearchives.nseindia.com/content/historical/EQUITIES/{YYYY}/{MMM}/cm{DDMMMYYYY}bhav.csv.zip
//
// Rows keep their series: EQ/BE/BZ (main board), SM/ST (SME Emerge), IV (InvIT), RR (REIT),
// E1 … (plan nse-index-history A3). Fetch semantics are nse-archive.ts's (A5): 404 = holiday,
// retry-then-stop, host fallback, 500 ms spacing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import {
  type ArchiveRange,
  fetchArchiveRange,
  fetchNseArchive,
  isKnownMissing,
  rememberMissing,
} from './nse-archive';

export { NSE_HEADERS } from './nse-archive';

export interface CmBhavRow {
  symbol: string; // bare NSE symbol, e.g. AAKAAR
  series: string; // SctySrs, e.g. SM
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** One day's bhavcopy: bare symbol → rows (a symbol can list in several series). */
export type CmBhavDay = Map<string, CmBhavRow[]>;

// ---------------------------------------------------------------------------
// Keys and series families (A3)
// ---------------------------------------------------------------------------

const SERIES_FAMILIES: string[][] = [
  ['EQ', 'BE', 'BZ'],
  ['SM', 'ST'],
];

/** Series that match `series` for lookup — its family, or just itself. */
export function seriesFamily(series: string): string[] {
  const s = series.toUpperCase();
  return SERIES_FAMILIES.find((f) => f.includes(s)) ?? [s];
}

/** Yahoo symbol → bhavcopy key `<SYM>:<SERIES>`; null when there is none (.BO, ^index). */
export function bhavKeyForYahoo(yahooSymbol: string): string | null {
  const sym = yahooSymbol.toUpperCase();
  const suffixed = /^(.+)-(SM|ST|IV|RR|E1)\.NS$/.exec(sym);
  if (suffixed) return `${suffixed[1]}:${suffixed[2]}`;
  const plain = /^([^^]+)\.NS$/.exec(sym);
  if (plain) return `${plain[1]}:EQ`;
  return null;
}

/** True for a Yahoo key that the A7 migration routes to the bhavcopy. */
export function isBhavcopySuffixed(yahooSymbol: string): boolean {
  return /-(SM|ST|IV|RR|E1)\.NS$/i.test(yahooSymbol);
}

export function parseBhavKey(key: string): { symbol: string; series: string } | null {
  const i = key.lastIndexOf(':');
  if (i <= 0 || i === key.length - 1) return null;
  return { symbol: key.slice(0, i), series: key.slice(i + 1) };
}

/** Series that carry equity-like instruments (never debt, bonds, G-secs, SGBs). */
const EQUITY_LIKE_SERIES = ['EQ', 'BE', 'BZ', 'SM', 'ST', 'SZ', 'IV', 'RR', 'E1'];

/**
 * The row for `key` on one day: the exact series, then its family; a main-board key
 * (`SYM:EQ`, what a plain `.NS` symbol maps to) finally takes any other equity-like series
 * the symbol trades in that day (A11 — "check all series present in the file").
 */
export function lookupBhav(day: CmBhavDay, key: string): CmBhavRow | null {
  const parsed = parseBhavKey(key);
  if (!parsed) return null;
  const rows = day.get(parsed.symbol);
  if (!rows) return null;
  const family = seriesFamily(parsed.series);
  return (
    rows.find((r) => r.series === parsed.series) ??
    rows.find((r) => family.includes(r.series)) ??
    (family.includes('EQ') ? rows.find((r) => EQUITY_LIKE_SERIES.includes(r.series)) : undefined) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function toNum(v: string | undefined): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

function addRow(day: CmBhavDay, row: CmBhavRow): void {
  const list = day.get(row.symbol);
  if (list) list.push(row);
  else day.set(row.symbol, [row]);
}

/** Parse either bhavcopy format (detected from the header) into a day map, all series. */
export function parseCmBhavcopy(csv: string): CmBhavDay {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim());
  const day: CmBhavDay = new Map();

  const udiff = header.indexOf('TckrSymb') >= 0;
  const idx = udiff
    ? {
        symbol: header.indexOf('TckrSymb'),
        series: header.indexOf('SctySrs'),
        open: header.indexOf('OpnPric'),
        high: header.indexOf('HghPric'),
        low: header.indexOf('LwPric'),
        close: header.indexOf('ClsPric'),
        vol: header.indexOf('TtlTradgVol'),
      }
    : {
        symbol: header.indexOf('SYMBOL'),
        series: header.indexOf('SERIES'),
        open: header.indexOf('OPEN'),
        high: header.indexOf('HIGH'),
        low: header.indexOf('LOW'),
        close: header.indexOf('CLOSE'),
        vol: header.indexOf('TOTTRDQTY'),
      };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new Error(`Unrecognised bhavcopy header: ${header.slice(0, 10).join(',')}`);
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] ?? '').split(',');
    if (cols.length < 5) continue;
    const symbol = cols[idx.symbol]?.trim();
    const series = cols[idx.series]?.trim();
    const close = toNum(cols[idx.close]);
    if (!symbol || !series || close <= 0) continue;
    addRow(day, {
      symbol,
      series,
      open: toNum(cols[idx.open]) || close,
      high: toNum(cols[idx.high]) || close,
      low: toNum(cols[idx.low]) || close,
      close,
      volume: Math.round(toNum(cols[idx.vol])),
    });
  }
  return day;
}

// Minimal ZIP reader — extracts the first file (stored or deflate).
export function extractCsvFromZip(buf: Buffer): string {
  const sig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sig < 0) throw new Error('Not a valid ZIP file');
  const compression = buf.readUInt16LE(sig + 8);
  const compressedSize = buf.readUInt32LE(sig + 18);
  const fileNameLen = buf.readUInt16LE(sig + 26);
  const extraLen = buf.readUInt16LE(sig + 28);
  const dataStart = sig + 30 + fileNameLen + extraLen;
  const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

  if (compression === 0) return compressedData.toString('utf-8');
  // Raw deflate. (The previous gzip-header wrapping had no trailer, so gunzip rejected every
  // real file with "unexpected end of file" — hidden by the old fallback's catch-all.)
  if (compression === 8) return inflateRawSync(compressedData).toString('utf-8');
  throw new Error(`Unsupported ZIP compression method: ${compression}`);
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** UDiFF files exist from 2024-01 (verified 03-01-2024); older days use the old format. */
const UDIFF_FROM = '2024-01-01';

function udiffPath(date: string): string {
  return `content/cm/BhavCopy_NSE_CM_0_0_0_${date.replace(/-/g, '')}_F_0000.csv.zip`;
}

function oldFormatPath(date: string): string {
  const [y, m, d] = date.split('-');
  const mon = MONTHS[parseInt(m ?? '1', 10) - 1] ?? 'JAN';
  return `content/historical/EQUITIES/${y}/${mon}/cm${d}${mon}${y}bhav.csv.zip`;
}

function cachePathFor(cacheDir: string, date: string): string {
  return join(cacheDir, `cm_${date.replace(/-/g, '')}.csv.gz`);
}

/** Compact cache body: only what parseCmBhavcopy needs, in the UDiFF column names. */
function compactCsv(day: CmBhavDay): string {
  const out = ['TckrSymb,SctySrs,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol'];
  for (const rows of day.values()) {
    for (const r of rows) {
      out.push(`${r.symbol},${r.series},${r.open},${r.high},${r.low},${r.close},${r.volume}`);
    }
  }
  return `${out.join('\n')}\n`;
}

/**
 * One trading day's bhavcopy, all series. Served from `<cacheDir>/cm_YYYYMMDD.csv.gz` when
 * present; a fetched file is cached there. null = 404 (holiday / not yet published).
 */
export async function fetchCmBhavcopy(
  date: string,
  cacheDir: string | null,
): Promise<{ data: CmBhavDay; cached: boolean } | null> {
  const cachePath = cacheDir ? cachePathFor(cacheDir, date) : null;
  if (cachePath && existsSync(cachePath)) {
    return {
      data: parseCmBhavcopy(gunzipSync(readFileSync(cachePath)).toString('utf-8')),
      cached: true,
    };
  }
  if (isKnownMissing(cachePath)) return null;
  let res = await fetchNseArchive(udiffPath(date));
  if (res.status === 'missing' && date < UDIFF_FROM)
    res = await fetchNseArchive(oldFormatPath(date));
  if (res.status === 'missing') {
    rememberMissing(cachePath, date);
    return null;
  }
  const data = parseCmBhavcopy(extractCsvFromZip(res.body));
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, gzipSync(compactCsv(data)));
  }
  return { data, cached: false };
}

/**
 * Sequential day walk over [from, to] with nse-archive range semantics (stop on failure).
 * `keep` (bare NSE symbols) trims each day in memory to the symbols the caller needs — a
 * full year of full files is ~100 MB of objects; the disk cache still holds every row.
 */
export function fetchCmBhavcopyRange(
  fromDate: string,
  toDate: string,
  cacheDir: string | null,
  onDay?: (done: number, total: number, date: string) => void,
  keep?: Set<string>,
): Promise<ArchiveRange<CmBhavDay>> {
  return fetchArchiveRange(
    fromDate,
    toDate,
    async (d) => {
      const got = await fetchCmBhavcopy(d, cacheDir);
      if (got === null || keep === undefined) return got;
      const trimmed: CmBhavDay = new Map();
      for (const sym of keep) {
        const rows = got.data.get(sym);
        if (rows) trimmed.set(sym, rows);
      }
      return { data: trimmed, cached: got.cached };
    },
    onDay,
  );
}
