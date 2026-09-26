// Add-only bulk import of NSE equities from a CSV (Symbol,Description,Sector,Industry).
//
// Never deactivates or overwrites: every write goes through store.addInstrument
// without `update`, and a symbol already in `instruments` is skipped before any
// feed call. upsertInstruments is deliberately NOT used — it soft-deactivates
// every row missing from its batch.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchQuote } from './fetcher';
import type { MarketDataStore, SyncResult } from './store';

export type ImportStatus = 'exists' | 'added' | 'rejected' | 'error';

export interface ImportCsvRow {
  symbol: string;
  description: string;
  sector: string;
  industry: string;
}

export interface ImportReportRow {
  csv_symbol: string;
  yahoo_symbol: string;
  status: ImportStatus;
  ohlcv_rows: number;
  note: string;
}

/** The two feed calls the import needs. Injectable so tests run without a network. */
export interface ImportFeed {
  quoteName(symbol: string): Promise<string>;
  backfill(store: MarketDataStore, symbol: string, fromDate: string): Promise<SyncResult>;
}

export const defaultImportFeed: ImportFeed = {
  async quoteName(symbol) {
    return (await fetchQuote(symbol)).name;
  },
  backfill(store, symbol, fromDate) {
    return store.backfillSymbol(symbol, fromDate);
  },
};

export interface ImportOptions {
  backfillDays?: number;
  batchSize?: number;
  delayMs?: number;
  /** Stop after this many rows needed a feed call (exists-skips don't count). */
  limit?: number;
  /** Prior report rows: `added` and `rejected` are carried forward without a feed call. */
  previous?: ImportReportRow[];
  feed?: ImportFeed;
  sleep?: (ms: number) => Promise<void>;
  /** Called after each batch with the full report so far (for crash-safe resume). */
  onBatch?: (report: ImportReportRow[], processed: number, pending: number) => void;
}

export interface ImportSummary {
  report: ImportReportRow[];
  counts: Record<ImportStatus, number>;
  /** Rows not attempted because `limit` was reached. */
  remaining: number;
}

/**
 * True only when the feed positively established that the symbol does not exist.
 * Everything else — timeouts, 429s, 5xx, unrecognised errors — is "could not
 * validate". The default is "not a miss" on purpose: a new failure mode added to
 * fetcher.ts must not silently start blocking registrations.
 */
export function isDefinitiveMiss(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('symbol not found:') || msg.includes('no data found, symbol may be delisted');
}

function isDbLocked(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('database is locked') || msg.includes('sqlite_busy');
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Reads a Symbol,Description,Sector,Industry file. Duplicate symbols keep the first row. */
export function readImportCsv(path: string): ImportCsvRow[] {
  const [header, ...body] = parseCsv(readFileSync(path, 'utf-8').replace(/^﻿/, ''));
  if (!header) return [];
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iSymbol = col('symbol');
  if (iSymbol === -1) throw new Error(`${path}: no Symbol column in header`);
  const iDesc = col('description');
  const iSector = col('sector');
  const iIndustry = col('industry');
  const at = (r: string[], i: number) => (i === -1 ? '' : (r[i] ?? '').trim());

  const seen = new Set<string>();
  const out: ImportCsvRow[] = [];
  for (const r of body) {
    const symbol = at(r, iSymbol).toUpperCase();
    if (symbol.length === 0 || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      description: at(r, iDesc),
      sector: at(r, iSector),
      industry: at(r, iIndustry),
    });
  }
  return out;
}

const REPORT_HEADER = ['csv_symbol', 'yahoo_symbol', 'status', 'ohlcv_rows', 'note'] as const;

export function writeImportReport(path: string, report: ImportReportRow[]): void {
  const lines = [REPORT_HEADER.join(',')];
  for (const r of report) {
    lines.push(
      [r.csv_symbol, r.yahoo_symbol, r.status, r.ohlcv_rows, r.note].map(csvField).join(','),
    );
  }
  writeFileSync(path, `${lines.join('\n')}\n`);
}

export function readImportReport(path: string): ImportReportRow[] {
  if (!existsSync(path)) return [];
  const [header, ...body] = parseCsv(readFileSync(path, 'utf-8'));
  if (!header || header.join(',') !== REPORT_HEADER.join(',')) return [];
  const statuses = new Set<string>(['exists', 'added', 'rejected', 'error']);
  return body
    .filter((r) => statuses.has(r[2] ?? ''))
    .map((r) => ({
      csv_symbol: r[0] ?? '',
      yahoo_symbol: r[1] ?? '',
      status: r[2] as ImportStatus,
      ohlcv_rows: Number(r[3] ?? 0) || 0,
      note: r[4] ?? '',
    }));
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const blank = (s: string): string | null => (s.trim().length > 0 ? s.trim() : null);

async function importOne(
  store: MarketDataStore,
  row: ImportCsvRow,
  yahoo: string,
  fromDate: string,
  feed: ImportFeed,
): Promise<ImportReportRow> {
  const base = { csv_symbol: row.symbol, yahoo_symbol: yahoo };
  let name = blank(row.description);

  // The backfill doubles as feed validation (same as nse_instrument_add with
  // backfill: true). It runs BEFORE the write so a rejected symbol never lands.
  let backfilled: SyncResult;
  try {
    if (name === null) name = await feed.quoteName(yahoo);
    backfilled = await feed.backfill(store, yahoo, fromDate);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (isDefinitiveMiss(err)) {
      return { ...base, status: 'rejected', ohlcv_rows: 0, note: reason };
    }
    if (isDbLocked(err)) throw err;
    return { ...base, status: 'error', ohlcv_rows: 0, note: reason };
  }

  const result = store.addInstrument({
    symbol: yahoo,
    name,
    exchange: 'NSE',
    sector: blank(row.sector),
    industry: blank(row.industry),
    instrument_type: 'equity',
    is_active: 1,
  });
  const rows = store.getSymbolCoverage(yahoo).rows;
  if (result.status === 'exists') {
    // Registered concurrently by another process between our check and write.
    return { ...base, status: 'exists', ohlcv_rows: rows, note: 'registered concurrently' };
  }
  return {
    ...base,
    status: 'added',
    ohlcv_rows: rows,
    note:
      backfilled.rowsInserted === 0
        ? 'registered; feed returned no candles in the backfill window'
        : `backfilled ${backfilled.fromDate} to ${backfilled.toDate}`,
  };
}

/**
 * Registers every CSV symbol (as `<Symbol>.NS`) that is not already in
 * `instruments`, backfilling price history for each. Add-only; resumable.
 */
export async function importInstruments(
  store: MarketDataStore,
  csvRows: ImportCsvRow[],
  opts: ImportOptions = {},
): Promise<ImportSummary> {
  const feed = opts.feed ?? defaultImportFeed;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const batchSize = Math.max(1, opts.batchSize ?? 10);
  const delayMs = Math.max(0, opts.delayMs ?? 5000);
  const days = opts.backfillDays ?? 365;
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const carried = new Map(
    (opts.previous ?? [])
      .filter((r) => r.status === 'added' || r.status === 'rejected')
      .map((r) => [r.csv_symbol, r]),
  );

  const registered = new Set(store.listInstrumentSymbols());
  const report: ImportReportRow[] = [];
  const pending: Array<{ row: ImportCsvRow; yahoo: string }> = [];

  for (const row of csvRows) {
    const yahoo = `${row.symbol}.NS`;
    const prior = carried.get(row.symbol);
    if (registered.has(yahoo)) {
      const rows = store.getSymbolCoverage(yahoo).rows;
      report.push(
        prior?.status === 'added'
          ? { ...prior, ohlcv_rows: rows }
          : {
              csv_symbol: row.symbol,
              yahoo_symbol: yahoo,
              status: 'exists',
              ohlcv_rows: rows,
              note: '',
            },
      );
    } else if (prior?.status === 'rejected') {
      report.push(prior);
    } else {
      pending.push({ row, yahoo });
    }
  }

  const limit = opts.limit ?? pending.length;
  const todo = pending.slice(0, limit);
  const remaining = pending.length - todo.length;

  for (let i = 0; i < todo.length; i += batchSize) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    for (const { row, yahoo } of todo.slice(i, i + batchSize)) {
      let entry: ImportReportRow | null = null;
      for (let attempt = 1; entry === null; attempt++) {
        try {
          entry = await importOne(store, row, yahoo, fromDate, feed);
        } catch (err) {
          // SQLite contention with other processes on the same DB: back off, retry.
          if (!isDbLocked(err) || attempt >= 4) {
            entry = {
              csv_symbol: row.symbol,
              yahoo_symbol: yahoo,
              status: 'error',
              ohlcv_rows: 0,
              note: err instanceof Error ? err.message : String(err),
            };
          } else {
            await sleep(delayMs * attempt || 1000 * attempt);
          }
        }
      }
      report.push(entry);
    }
    opts.onBatch?.(report, Math.min(i + batchSize, todo.length), todo.length);
  }

  const counts: Record<ImportStatus, number> = { exists: 0, added: 0, rejected: 0, error: 0 };
  for (const r of report) counts[r.status]++;
  return { report, counts, remaining };
}
