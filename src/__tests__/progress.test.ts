import { describe, expect, it } from 'vitest';
import { createProgressReporter, emptySummary, formatSyncSummary } from '../progress';

function collect(clock: { t: number }) {
  const lines: Array<{ message: string; percent: number }> = [];
  const report = createProgressReporter((message, percent) => lines.push({ message, percent }), {
    now: () => clock.t,
  });
  return { lines, report };
}

describe('createProgressReporter', () => {
  it('prints the start line with totals split by source', () => {
    const clock = { t: 0 };
    const { lines, report } = collect(clock);
    report({
      kind: 'start',
      op: 'update',
      total: 3247,
      bySource: { nse_index: 38, bhavcopy: 273, yahoo: 2936, resolve: 0 },
    });
    expect(lines[0]?.message).toBe(
      'Updating 3,247 symbols: 38 indices via NSE file, 273 via bhavcopy, 2,936 via Yahoo',
    );
  });

  it('throttles: one line per 25 symbols when the clock does not move, plus the last', () => {
    const clock = { t: 0 };
    const { lines, report } = collect(clock);
    report({
      kind: 'start',
      op: 'update',
      total: 60,
      bySource: { nse_index: 0, bhavcopy: 0, yahoo: 60, resolve: 0 },
    });
    for (let i = 1; i <= 60; i++) {
      report({
        kind: 'symbols',
        done: i,
        total: 60,
        symbols: [`SYM${i}.NS`],
        failed: i > 40 ? 2 : 0,
      });
    }
    const progress = lines.slice(1).map((l) => l.message);
    expect(progress).toEqual([
      '25/60 (42%) — SYM1, SYM2, SYM3 +22 more',
      '50/60 (83%) — SYM26, SYM27, SYM28 +22 more — 2 failed',
      '60/60 (100%) — SYM51, SYM52, SYM53 +7 more — 2 failed',
    ]);
    expect(lines[lines.length - 1]?.percent).toBe(100);
  });

  it('throttles on time: a line after 2 s even with fewer than 25 symbols', () => {
    const clock = { t: 0 };
    const { lines, report } = collect(clock);
    report({
      kind: 'start',
      op: 'backfill',
      total: 100,
      bySource: { nse_index: 0, bhavcopy: 0, yahoo: 100, resolve: 0 },
    });
    report({ kind: 'symbols', done: 1, total: 100, symbols: ['A.NS'], failed: 0 });
    clock.t = 1500;
    report({ kind: 'symbols', done: 2, total: 100, symbols: ['B.NS'], failed: 0 });
    expect(lines).toHaveLength(1);
    clock.t = 2100;
    report({ kind: 'symbols', done: 3, total: 100, symbols: ['C.NS'], failed: 0 });
    expect(lines.map((l) => l.message)[1]).toBe('3/100 (3%) — A, B, C');
  });

  it('reports file-pass days as "day k/n (DD-MM-YYYY)", first and last always', () => {
    const clock = { t: 0 };
    const { lines, report } = collect(clock);
    for (let d = 1; d <= 10; d++) {
      report({
        kind: 'day',
        source: 'bhavcopy',
        day: d,
        days: 10,
        date: `2026-09-${String(10 + d).padStart(2, '0')}`,
      });
    }
    expect(lines.map((l) => l.message)).toEqual([
      'NSE bhavcopy: day 1/10 (11-09-2026)',
      'NSE bhavcopy: day 10/10 (20-09-2026)',
    ]);
  });
});

describe('formatSyncSummary', () => {
  it('is short: totals, rows per source, switches and the failed list with reasons', () => {
    const s = emptySummary('update', 3247);
    s.durationMs = 252_000;
    s.bySource.nse_index = { symbols: 38, rows: 38 };
    s.bySource.bhavcopy = { symbols: 273, rows: 212 };
    s.bySource.yahoo = { symbols: 2911, rows: 2901 };
    s.filledDays = 4;
    s.switches.push({
      symbol: 'FOO.NS',
      from: 'yahoo',
      to: 'bhavcopy',
      key: 'FOO:EQ',
      reason: 'Yahoo had no bar for 3 consecutive trading days the NSE bhavcopy has',
    });
    for (let i = 0; i < 25; i++) {
      s.failed.push({
        symbol: `BAD${i}.NS`,
        source: 'yahoo',
        reason: `Symbol not found: BAD${i}.NS`,
      });
    }
    const text = formatSyncSummary(s);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Update complete: 3,247 symbols in 4m 12s — 3,222 ok, 25 failed.');
    expect(lines[1]).toBe(
      'New rows: 3,151 — NSE index file 38 (38 symbols) · bhavcopy 212 (273 symbols) · Yahoo 2,901 (2,911 symbols); 4 Yahoo day(s) filled from the bhavcopy.',
    );
    expect(text).toContain('Source switches (1):\n  FOO.NS: yahoo → bhavcopy (FOO:EQ)');
    expect(text).toContain('Failed (25):\n  BAD0.NS [yahoo] Symbol not found: BAD0.NS');
    expect(text).toContain('  +5 more');
    expect(text).not.toContain('BAD24.NS');
    expect(lines.length).toBeLessThan(30); // not one line per symbol
  });
});
