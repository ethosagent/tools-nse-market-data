// NSE archive HTTP — shared by the index-close file (nse-indices.ts) and the CM
// bhavcopy (bhavcopy.ts).
//
// Semantics (plan nse-index-history D5, A5, A9):
//   - 404 → the file does not exist (holiday, weekend, or not yet published): `missing`.
//   - network error / 5xx on the primary host → the same path on the fallback host.
//   - anything else that is not a 200 → retried after 2 s, 4 s, 8 s; then NseArchiveError.
//     Callers stop their date range at that day rather than skipping it.
//   - requests are spaced MIN_INTERVAL_MS apart (module-level, like nse-fetcher.ts).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.nseindia.com/',
};

export const NSE_ARCHIVE_HOSTS = ['nsearchives.nseindia.com', 'archives.nseindia.com'] as const;

interface ArchiveConfig {
  minIntervalMs: number;
  retryDelaysMs: number[];
  timeoutMs: number;
}

const DEFAULT_CONFIG: ArchiveConfig = {
  minIntervalMs: 500,
  retryDelaysMs: [2000, 4000, 8000],
  timeoutMs: 30_000,
};

let config: ArchiveConfig = { ...DEFAULT_CONFIG };
let lastCallAt = 0;

/** Test hook: shrink spacing/retry delays. Pass nothing to restore the defaults. */
export function configureNseArchive(overrides?: Partial<ArchiveConfig>): void {
  config = { ...DEFAULT_CONFIG, ...(overrides ?? {}) };
  lastCallAt = 0;
}

export class NseArchiveError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`NSE archive ${path}: ${detail}`);
    this.name = 'NseArchiveError';
  }
}

export type ArchiveResult = { status: 'ok'; body: Buffer } | { status: 'missing' };

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

async function spacedFetch(url: string): Promise<Response> {
  const wait = config.minIntervalMs - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  return fetch(url, { headers: NSE_HEADERS, signal: AbortSignal.timeout(config.timeoutMs) });
}

type Attempt =
  | { kind: 'ok'; body: Buffer }
  | { kind: 'missing' }
  | { kind: 'error'; detail: string };

/** One attempt: primary host, then the fallback host on a network error or 5xx. */
async function attempt(path: string): Promise<Attempt> {
  let lastDetail = 'no response';
  for (const host of NSE_ARCHIVE_HOSTS) {
    let res: Response;
    try {
      res = await spacedFetch(`https://${host}/${path}`);
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      continue; // network error → fallback host
    }
    if (res.status === 404) return { kind: 'missing' };
    if (res.ok) return { kind: 'ok', body: Buffer.from(await res.arrayBuffer()) };
    lastDetail = `HTTP ${res.status}`;
    if (res.status < 500) return { kind: 'error', detail: lastDetail }; // 4xx: fallback host would say the same
  }
  return { kind: 'error', detail: lastDetail };
}

/**
 * Fetch `path` (no leading slash) from the NSE archive hosts.
 * Resolves `missing` on 404, throws NseArchiveError after the retries are spent.
 */
export async function fetchNseArchive(path: string): Promise<ArchiveResult> {
  let detail = '';
  for (let i = 0; i <= config.retryDelaysMs.length; i++) {
    if (i > 0) await sleep(config.retryDelaysMs[i - 1] ?? 0);
    const r = await attempt(path);
    if (r.kind === 'ok') return { status: 'ok', body: r.body };
    if (r.kind === 'missing') return { status: 'missing' };
    detail = r.detail;
  }
  throw new NseArchiveError(path, `${detail} after ${config.retryDelaysMs.length + 1} attempts`);
}

/** Mon–Fri calendar dates between from and to, inclusive (YYYY-MM-DD). */
export function weekdaysBetween(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** YYYY-MM-DD → DD-MM-YYYY (the form NSE prints and the progress lines show). */
export function toDdMmYyyy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

/** Result of a day-by-day range fetch over an NSE archive file series. */
export interface ArchiveRange<T> {
  /** Days that returned a file, ascending, with their parsed content. */
  days: Array<{ date: string; data: T }>;
  /** Days that returned 404 (holiday / not yet published). */
  missingDates: string[];
  /** First day that failed after retries; the range stops here (D5). null = completed. */
  stoppedAt: string | null;
  stopReason: string | null;
  /** Days served from the disk cache (no request). */
  cachedDays: number;
}

/**
 * Walk the weekdays of [from, to] sequentially, calling `fetchDay` for each.
 * `fetchDay` returns the parsed data, null for a missing day, and throws to stop the range.
 */
export async function fetchArchiveRange<T>(
  fromDate: string,
  toDate: string,
  fetchDay: (date: string) => Promise<{ data: T; cached: boolean } | null>,
  onDay?: (done: number, total: number, date: string) => void,
): Promise<ArchiveRange<T>> {
  const dates = weekdaysBetween(fromDate, toDate);
  const out: ArchiveRange<T> = {
    days: [],
    missingDates: [],
    stoppedAt: null,
    stopReason: null,
    cachedDays: 0,
  };
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i] as string;
    let got: { data: T; cached: boolean } | null;
    try {
      got = await fetchDay(date);
    } catch (err) {
      out.stoppedAt = date;
      out.stopReason = err instanceof Error ? err.message : String(err);
      onDay?.(i + 1, dates.length, date);
      break;
    }
    if (got === null) out.missingDates.push(date);
    else {
      out.days.push({ date, data: got.data });
      if (got.cached) out.cachedDays++;
    }
    onDay?.(i + 1, dates.length, date);
  }
  return out;
}

/**
 * A 404 for a date at least this many days old is a holiday, not a late file, so it is
 * remembered next to the cache (`<file>.404`) and never requested again. Newer 404s are
 * not remembered: today's file appears in the evening.
 */
export const HOLIDAY_AFTER_DAYS = 7;

export function isKnownMissing(cachePath: string | null): boolean {
  return cachePath !== null && existsSync(`${cachePath}.404`);
}

export function rememberMissing(cachePath: string | null, isoDate: string): void {
  if (cachePath === null) return;
  const ageDays = (Date.now() - Date.parse(`${isoDate}T00:00:00Z`)) / 86_400_000;
  if (ageDays < HOLIDAY_AFTER_DAYS) return;
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(`${cachePath}.404`, '');
}
