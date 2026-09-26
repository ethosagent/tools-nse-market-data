// NSE daily all-indices close file + index constituent lists.
//
//   https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
//   https://nsearchives.nseindia.com/content/indices/ind_<slug>list.csv
//
// One file per trading day carries OHLC + volume for every NSE index, so any number of
// indices costs one request per day (plan nse-index-history D1, D11/A5).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ArchiveRange,
  fetchArchiveRange,
  fetchNseArchive,
  isKnownMissing,
  rememberMissing,
  weekdaysBetween,
} from './nse-archive';

export interface IndexCloseRow {
  /** Index name exactly as printed in the file. */
  name: string;
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Parsed file: normalised name → row. */
export type IndexCloseDay = Map<string, IndexCloseRow>;

export interface IndexCatalogueEntry {
  symbol: string;
  nse_name: string;
  category: string;
  constituents_slug: string | null;
}

/** Earliest date the index backfill accepts (D8: pre-2016 files use the old CNX names). */
export const INDEX_HISTORY_MIN_DATE = '2016-01-01';

/** D6: names match case- and whitespace-insensitively. */
export function normalizeIndexName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** D3: `^` + NSE name uppercased with every non-[A-Z0-9] removed. */
export function deriveIndexKey(nseName: string): string {
  return `^${nseName.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
}

/** Guessed constituent-file slug for an index outside the catalogue. */
export function guessConstituentsSlug(nseName: string): string {
  return nseName.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function indexCloseFileName(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `ind_close_all_${d}${m}${y}.csv`;
}

const REQUIRED_COLUMNS = [
  'Index Name',
  'Index Date',
  'Open Index Value',
  'High Index Value',
  'Low Index Value',
  'Closing Index Value',
] as const;

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** DD-MM-YYYY → YYYY-MM-DD. */
function isoFromNseDate(v: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Parse one ind_close_all file. Throws when the header lacks the six OHLC columns (D6).
 * `-` volume (India VIX, bond indices) → 0; a `-` open/high/low falls back to the close;
 * a row without a numeric close is skipped.
 */
export function parseIndexClose(csv: string): IndexCloseDay {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim());
  const idx = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof REQUIRED_COLUMNS)[number],
    number
  >;
  const missing = REQUIRED_COLUMNS.filter((c) => idx[c] < 0);
  if (missing.length > 0) {
    throw new Error(`NSE index file header is missing: ${missing.join(', ')}`);
  }
  const volIdx = header.indexOf('Volume');

  const out: IndexCloseDay = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    const cols = line.split(',');
    const name = cols[idx['Index Name']]?.trim();
    const date = isoFromNseDate(cols[idx['Index Date']] ?? '');
    const close = num(cols[idx['Closing Index Value']]);
    if (!name || !date || close === null) continue;
    out.set(normalizeIndexName(name), {
      name,
      date,
      open: num(cols[idx['Open Index Value']]) ?? close,
      high: num(cols[idx['High Index Value']]) ?? close,
      low: num(cols[idx['Low Index Value']]) ?? close,
      close,
      volume: Math.round(volIdx >= 0 ? (num(cols[volIdx]) ?? 0) : 0),
    });
  }
  return out;
}

/**
 * One day's file. Served from `<cacheDir>/ind_close_all_DDMMYYYY.csv` when present (D10);
 * a fetched 200 is written there. null = 404 (no trading / not published yet).
 */
export async function fetchIndexClose(
  isoDate: string,
  cacheDir: string | null,
): Promise<{ data: IndexCloseDay; cached: boolean } | null> {
  const file = indexCloseFileName(isoDate);
  const cachePath = cacheDir ? join(cacheDir, file) : null;
  if (cachePath && existsSync(cachePath)) {
    return { data: parseIndexClose(readFileSync(cachePath, 'utf-8')), cached: true };
  }
  if (isKnownMissing(cachePath)) return null;
  const res = await fetchNseArchive(`content/indices/${file}`);
  if (res.status === 'missing') {
    rememberMissing(cachePath, isoDate);
    return null;
  }
  const text = res.body.toString('utf-8');
  const data = parseIndexClose(text); // throws on a bad header before anything is cached
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, text);
  }
  return { data, cached: false };
}

export function fetchIndexCloseRange(
  fromDate: string,
  toDate: string,
  cacheDir: string | null,
  onDay?: (done: number, total: number, date: string) => void,
): Promise<ArchiveRange<IndexCloseDay>> {
  return fetchArchiveRange(fromDate, toDate, (d) => fetchIndexClose(d, cacheDir), onDay);
}

/**
 * The most recent published file on or before `toDate`, walking back up to 10 weekdays.
 * Used to validate names (D15) — "in the latest NSE file".
 */
export async function fetchLatestIndexClose(
  toDate: string,
  cacheDir: string | null,
): Promise<{ date: string; data: IndexCloseDay } | null> {
  const from = new Date(`${toDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 14);
  const dates = weekdaysBetween(from.toISOString().slice(0, 10), toDate).reverse();
  for (const date of dates.slice(0, 10)) {
    const got = await fetchIndexClose(date, cacheDir);
    if (got !== null) return { date, data: got.data };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Name suggestions (D16)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

/** The `count` names closest to `query` by normalised Levenshtein distance. */
export function suggestIndexNames(query: string, names: string[], count = 3): string[] {
  const q = normalizeIndexName(query);
  return names
    .map((n) => {
      const nn = normalizeIndexName(n);
      return { n, d: levenshtein(q, nn) / Math.max(q.length, nn.length, 1) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((x) => x.n);
}

// ---------------------------------------------------------------------------
// Catalogue (data/nse_indices.json)
// ---------------------------------------------------------------------------

let catalogueCache: IndexCatalogueEntry[] | null = null;

export function loadIndexCatalogue(): IndexCatalogueEntry[] {
  if (catalogueCache === null) {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'nse_indices.json');
    try {
      catalogueCache = JSON.parse(readFileSync(path, 'utf-8')) as IndexCatalogueEntry[];
    } catch {
      catalogueCache = [];
    }
  }
  return catalogueCache;
}

export function catalogueBySymbol(symbol: string): IndexCatalogueEntry | undefined {
  return loadIndexCatalogue().find((e) => e.symbol === symbol);
}

export function catalogueByName(nseName: string): IndexCatalogueEntry | undefined {
  const n = normalizeIndexName(nseName);
  return loadIndexCatalogue().find((e) => normalizeIndexName(e.nse_name) === n);
}

// ---------------------------------------------------------------------------
// Constituents
// ---------------------------------------------------------------------------

export interface ConstituentRow {
  /** Yahoo-style member key, `<Symbol>.NS`. */
  symbol: string;
  company: string;
  industry: string;
  series: string;
}

/** Parse `Company Name,Industry,Symbol,Series,ISIN Code`. */
export function parseConstituents(csv: string): ConstituentRow[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim());
  const si = header.indexOf('Symbol');
  if (si < 0) throw new Error('NSE constituent file has no Symbol column');
  const ci = header.indexOf('Company Name');
  const ii = header.indexOf('Industry');
  const se = header.indexOf('Series');
  const rows: ConstituentRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] ?? '').split(',');
    const sym = cols[si]?.trim();
    if (!sym) continue;
    const key = `${sym}.NS`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      symbol: key,
      company: cols[ci]?.trim() ?? '',
      industry: cols[ii]?.trim() ?? '',
      series: cols[se]?.trim() ?? '',
    });
  }
  return rows;
}

/** Fetch `ind_<slug>list.csv`. null = 404 (no such constituent file). */
export async function fetchConstituents(slug: string): Promise<ConstituentRow[] | null> {
  const res = await fetchNseArchive(`content/indices/ind_${slug}list.csv`);
  if (res.status === 'missing') return null;
  return parseConstituents(res.body.toString('utf-8'));
}
