// Progress events for update/backfill and the one formatter the tools and the CLI share
// (plan nse-index-history A6). The store emits one event per symbol; the reporter decides
// when a line is worth printing.

import type { PriceSource } from './schema';

/** Owner decision A11: which source serves non-index symbols first. */
export type SourcePreference = 'bhavcopy' | 'yahoo';

export interface SourceCounts {
  nse_index: number;
  bhavcopy: number;
  yahoo: number;
  /** Symbols with no stored source yet — resolved during this run (A2). */
  resolve: number;
}

export type SyncProgress =
  | {
      kind: 'start';
      op: 'update' | 'backfill';
      total: number;
      bySource: SourceCounts;
      fromDate?: string;
      preference?: SourcePreference;
    }
  | {
      kind: 'day';
      source: 'nse_index' | 'bhavcopy';
      day: number;
      days: number;
      date: string; // YYYY-MM-DD
    }
  | { kind: 'symbols'; done: number; total: number; symbols: string[]; failed: number };

export interface SyncResult {
  symbol: string;
  rowsInserted: number;
  fromDate: string;
  toDate: string;
  /** Set when this run resolved or used a price source (A2/A8). */
  priceSource?: PriceSource;
  sourceKey?: string;
}

export interface SyncFailure {
  symbol: string;
  source: PriceSource | 'unresolved';
  reason: string;
}

export interface SourceSwitch {
  symbol: string;
  from: PriceSource | null;
  to: PriceSource;
  key: string;
  reason: string;
}

/** Symbols served by something other than the preferred source, grouped by reason (A11). */
export interface SourceFallback {
  to: PriceSource;
  reason: string;
  symbols: string[];
}

export interface SyncSummary {
  op: 'update' | 'backfill';
  preference: SourcePreference;
  total: number;
  durationMs: number;
  /** Symbols handled and new rows written, by the source that served them. */
  bySource: Record<PriceSource, { symbols: number; rows: number }>;
  /** Yahoo-sourced symbol-days filled from the bhavcopy (A4). */
  filledDays: number;
  /** Sources set for the first time in this run (A2). */
  resolved: Array<{ symbol: string; source: PriceSource; key: string; partial: boolean }>;
  switches: SourceSwitch[];
  fallbacks: SourceFallback[];
  failed: SyncFailure[];
  /** Range stops, index names missing from a file, constituent refreshes. */
  notes: string[];
  results: SyncResult[];
}

export function emptySummary(
  op: 'update' | 'backfill',
  total: number,
  preference: SourcePreference = 'bhavcopy',
): SyncSummary {
  return {
    op,
    preference,
    total,
    durationMs: 0,
    bySource: {
      nse_index: { symbols: 0, rows: 0 },
      bhavcopy: { symbols: 0, rows: 0 },
      yahoo: { symbols: 0, rows: 0 },
    },
    filledDays: 0,
    resolved: [],
    switches: [],
    fallbacks: [],
    failed: [],
    notes: [],
    results: [],
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmt = (n: number): string => n.toLocaleString('en-IN');

/** `RELIANCE.NS` → `RELIANCE`; indices keep their caret. */
export function bareSymbol(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/i, '');
}

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export function formatStart(e: Extract<SyncProgress, { kind: 'start' }>): string {
  const verb = e.op === 'update' ? 'Updating' : 'Backfilling';
  const parts: string[] = [];
  if (e.bySource.nse_index > 0) parts.push(`${fmt(e.bySource.nse_index)} indices via NSE file`);
  if (e.bySource.bhavcopy > 0) parts.push(`${fmt(e.bySource.bhavcopy)} via bhavcopy`);
  if (e.bySource.yahoo > 0) parts.push(`${fmt(e.bySource.yahoo)} via Yahoo`);
  if (e.bySource.resolve > 0) {
    parts.push(`${fmt(e.bySource.resolve)} to resolve (Yahoo, then bhavcopy)`);
  }
  const from = e.fromDate ? ` from ${e.fromDate}` : '';
  // Indices ignore the preference, so an index-only run does not mention it.
  const stocks = e.bySource.bhavcopy + e.bySource.yahoo + e.bySource.resolve;
  const pref =
    e.preference && stocks > 0
      ? ` (prefer ${e.preference === 'bhavcopy' ? 'NSE bhavcopy' : 'Yahoo'})`
      : '';
  return `${verb} ${fmt(e.total)} symbols${from}${pref}: ${parts.length > 0 ? parts.join(', ') : 'nothing to do'}`;
}

function formatBatch(symbols: string[], bare = true): string {
  const shown = symbols
    .slice(0, 3)
    .map((sym) => (bare ? bareSymbol(sym) : sym))
    .join(', ');
  return symbols.length > 3 ? `${shown} +${symbols.length - 3} more` : shown;
}

export interface ProgressReporterOptions {
  everySymbols?: number;
  everyMs?: number;
  now?: () => number;
}

/**
 * Turn SyncProgress events into user-facing lines. A symbols line goes out at most every
 * `everySymbols` symbols or `everyMs` ms, whichever first (plus the final one); day lines
 * from the file passes use the same clock.
 */
export function createProgressReporter(
  sink: (message: string, percent: number) => void,
  opts: ProgressReporterOptions = {},
): (e: SyncProgress) => void {
  const everySymbols = opts.everySymbols ?? 25;
  const everyMs = opts.everyMs ?? 2000;
  const now = opts.now ?? Date.now;

  let total = 0;
  let done = 0;
  let pending: string[] = [];
  let lastEmit = now();
  const percent = () => (total > 0 ? Math.round((done / total) * 100) : 0);

  return (e) => {
    const t = now();
    if (e.kind === 'start') {
      total = e.total;
      lastEmit = t;
      sink(formatStart(e), 0);
      return;
    }
    if (e.kind === 'day') {
      if (e.day === 1 || e.day === e.days || t - lastEmit >= everyMs) {
        lastEmit = t;
        const label = e.source === 'nse_index' ? 'NSE index file' : 'NSE bhavcopy';
        sink(`${label}: day ${e.day}/${e.days} (${ddmmyyyy(e.date)})`, percent());
      }
      return;
    }
    total = e.total;
    done = e.done;
    pending.push(...e.symbols);
    const final = e.done >= e.total;
    if (pending.length >= everySymbols || t - lastEmit >= everyMs || final) {
      lastEmit = t;
      const failed = e.failed > 0 ? ` — ${fmt(e.failed)} failed` : '';
      sink(
        `${fmt(e.done)}/${fmt(e.total)} (${percent()}%) — ${formatBatch(pending)}${failed}`,
        percent(),
      );
      pending = [];
    }
  };
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

const SOURCE_LABEL: Record<PriceSource, string> = {
  nse_index: 'NSE index file',
  bhavcopy: 'bhavcopy',
  yahoo: 'Yahoo',
};

/** The short final summary (A6): totals, duration, rows per source, switches, failures. */
export function formatSyncSummary(s: SyncSummary, maxFailed = 20): string {
  const verb = s.op === 'update' ? 'Update' : 'Backfill';
  const lines: string[] = [];
  const ok = s.total - s.failed.length;
  lines.push(
    `${verb} complete: ${fmt(s.total)} symbols in ${formatDuration(s.durationMs)} — ${fmt(ok)} ok, ${fmt(s.failed.length)} failed.`,
  );
  const rowParts = (Object.keys(SOURCE_LABEL) as PriceSource[])
    .filter((k) => s.bySource[k].symbols > 0)
    .map(
      (k) =>
        `${SOURCE_LABEL[k]} ${fmt(s.bySource[k].rows)} (${fmt(s.bySource[k].symbols)} symbols)`,
    );
  const totalRows = (Object.keys(SOURCE_LABEL) as PriceSource[]).reduce(
    (n, k) => n + s.bySource[k].rows,
    0,
  );
  lines.push(
    `New rows: ${fmt(totalRows)}${rowParts.length > 0 ? ` — ${rowParts.join(' · ')}` : ''}${
      s.filledDays > 0 ? `; ${fmt(s.filledDays)} Yahoo day(s) filled from the bhavcopy` : ''
    }.`,
  );
  if (s.resolved.length > 0) {
    const by = (src: PriceSource) => s.resolved.filter((r) => r.source === src).length;
    const partial = s.resolved.filter((r) => r.partial).length;
    lines.push(
      `Sources resolved: ${s.resolved.length} (Yahoo ${by('yahoo')}, bhavcopy ${by('bhavcopy')}, NSE index ${by('nse_index')})${
        partial > 0 ? `; ${partial} on partial Yahoo history` : ''
      }.`,
    );
  }
  for (const f of s.fallbacks) {
    lines.push(
      `${fmt(f.symbols.length)} ${f.to === 'yahoo' ? 'via Yahoo' : f.to === 'bhavcopy' ? 'kept on bhavcopy' : `via ${SOURCE_LABEL[f.to]}`}: ${f.reason} (${formatBatch(f.symbols, false)}).`,
    );
  }
  if (s.switches.length > 0) {
    lines.push(`Source switches (${s.switches.length}):`);
    for (const sw of s.switches) {
      lines.push(`  ${sw.symbol}: ${sw.from ?? 'none'} → ${sw.to} (${sw.key}) — ${sw.reason}`);
    }
  }
  for (const note of s.notes) lines.push(note);
  if (s.failed.length > 0) {
    lines.push(`Failed (${s.failed.length}):`);
    for (const f of s.failed.slice(0, maxFailed)) {
      lines.push(`  ${f.symbol} [${f.source}] ${f.reason}`);
    }
    if (s.failed.length > maxFailed) lines.push(`  +${s.failed.length - maxFailed} more`);
  }
  return lines.join('\n');
}
