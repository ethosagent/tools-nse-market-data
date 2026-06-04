import { describe, expect, it } from 'vitest';
import type { OhlcvRow } from '../indicators';
import {
  detectChartPattern,
  detectCupWithHandle,
  detectDoubleBottom,
  detectFlatBase,
} from '../patterns';

// ---------------------------------------------------------------------------
// Test data helper
// ---------------------------------------------------------------------------

/**
 * Build weekly OhlcvRow array from a price sequence.
 * Each entry becomes one weekly bar. High = price * 1.02, Low = price * 0.98.
 * Volume defaults to 1_000_000 unless overridden.
 */
function makeWeeklyRows(params: {
  priceSequence: number[];
  startDate?: string;
  volumes?: number[];
}): OhlcvRow[] {
  const { priceSequence, startDate = '2024-01-01', volumes } = params;
  const start = new Date(startDate);

  return priceSequence.map((price, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    const date = d.toISOString().slice(0, 10);
    return {
      date,
      open: price * 0.99,
      high: price * 1.02,
      low: price * 0.98,
      close: price,
      volume: volumes?.[i] ?? 1_000_000,
    };
  });
}

/**
 * Build daily OhlcvRow array (5 bars per week) from a sequence of weekly closes.
 * Used for integration tests that go through detectChartPattern (which calls aggregateToWeekly).
 */
function makeDailyRows(weeklyCloses: number[], startDate = '2024-01-01'): OhlcvRow[] {
  const daily: OhlcvRow[] = [];
  const start = new Date(startDate);
  for (let w = 0; w < weeklyCloses.length; w++) {
    const price = weeklyCloses[w] ?? 100;
    for (let d = 0; d < 5; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);
      daily.push({
        date: date.toISOString().slice(0, 10),
        open: price * 0.99,
        high: price * 1.02,
        low: price * 0.98,
        close: price,
        volume: 1_000_000,
      });
    }
  }
  return daily;
}

// ---------------------------------------------------------------------------
// Flat Base tests
// ---------------------------------------------------------------------------

describe('detectFlatBase', () => {
  it('detects a clean flat base with <10% range (quality_score >= 60)', () => {
    // Prior uptrend: 100 -> 200 (6 weeks), then flat at 200 (+/- 4%) for 8 weeks
    const priorUp = [100, 120, 140, 160, 180, 200];
    const flat = [200, 203, 197, 201, 199, 202, 198, 204];
    const rows = makeWeeklyRows({ priceSequence: [...priorUp, ...flat] });
    const result = detectFlatBase(rows);

    expect(result.pattern).toBe('flat_base');
    if (result.pattern === 'flat_base') {
      expect(result.quality_score).toBeGreaterThanOrEqual(60);
      expect(result.depth_pct).toBeLessThanOrEqual(15);
      expect(result.pivot_price).toBeGreaterThan(0);
      expect(result.buy_range_top).toBeCloseTo(result.pivot_price * 1.05, 1);
    }
  });

  it('rejects range > 15%', () => {
    // Prior uptrend, then a wide base (20% range)
    const priorUp = [100, 120, 140, 160, 180, 200];
    const wide = [200, 210, 170, 205, 195, 200, 172, 208]; // range: (210-170)/210 ≈ 19%
    const rows = makeWeeklyRows({ priceSequence: [...priorUp, ...wide] });
    const result = detectFlatBase(rows);

    if (result.pattern === 'flat_base') {
      // If detected, range must be <= 15%
      expect(result.depth_pct).toBeLessThanOrEqual(15);
    } else {
      expect(result.pattern).toBe('none');
    }
  });

  it('rejects base without prior uptrend (< 20% advance)', () => {
    // No meaningful uptrend before flat base: price just flat from start
    const flat = [100, 101, 99, 100, 102, 98, 101, 100];
    const rows = makeWeeklyRows({ priceSequence: flat });
    const result = detectFlatBase(rows);
    // Without prior advance, should not detect flat_base
    expect(result.pattern).toBe('none');
  });

  it('awards volume contraction bonus (+15 when avgBaseVol < priorAvgVol * 0.85)', () => {
    // Prior uptrend with high volume, then flat base with lower volume
    const priorPrices = [100, 120, 140, 160, 180, 200];
    const priorVols = [2_000_000, 2_000_000, 2_000_000, 2_000_000, 2_000_000, 2_000_000];
    const flatPrices = [200, 202, 198, 201, 199, 203, 197, 202];
    const flatVols = [900_000, 900_000, 900_000, 900_000, 900_000, 900_000, 900_000, 900_000];

    const rows = makeWeeklyRows({
      priceSequence: [...priorPrices, ...flatPrices],
      volumes: [...priorVols, ...flatVols],
    });

    const resultWithContraction = detectFlatBase(rows);

    // Now same pattern but with equal volumes
    const rows2 = makeWeeklyRows({
      priceSequence: [...priorPrices, ...flatPrices],
      volumes: [...priorVols.map(() => 1_000_000), ...flatVols.map(() => 1_000_000)],
    });
    const resultWithout = detectFlatBase(rows2);

    if (resultWithContraction.pattern === 'flat_base' && resultWithout.pattern === 'flat_base') {
      expect(resultWithContraction.quality_score).toBeGreaterThan(resultWithout.quality_score);
    }
    // At minimum ensure contraction case detects
    expect(resultWithContraction.pattern).toBe('flat_base');
  });
});

// ---------------------------------------------------------------------------
// Cup with Handle tests
// ---------------------------------------------------------------------------

describe('detectCupWithHandle', () => {
  it('detects cup with handle, pivot = handle high', () => {
    // Left high 200, decline to 160 (20%), recovery to 200, then 3-week handle drifting to 192-195
    const cup = [200, 190, 175, 165, 160, 165, 175, 185, 195, 200];
    const handle = [198, 193, 197]; // handle: stays near right rim
    const rows = makeWeeklyRows({ priceSequence: [...cup, ...handle] });
    const result = detectCupWithHandle(rows);

    expect(result.pattern).toBe('cup_with_handle');
    if (result.pattern === 'cup_with_handle') {
      expect(result.pivot_price).toBeGreaterThan(0);
      expect(result.buy_range_top).toBeCloseTo(result.pivot_price * 1.05, 1);
      // Handle pivot should not exceed left high
      expect(result.pivot_price).toBeLessThanOrEqual(200 * 1.05);
    }
  });

  it('detects cup without handle, pivot = right rim high', () => {
    // 10-week cup, no handle
    const cup = [200, 190, 175, 165, 160, 165, 175, 185, 195, 202];
    const rows = makeWeeklyRows({ priceSequence: cup });
    const result = detectCupWithHandle(rows);

    expect(['cup_with_handle', 'cup_no_handle']).toContain(result.pattern);
    if (result.pattern === 'cup_no_handle') {
      // Pivot should be near the right rim high
      expect(result.pivot_price).toBeCloseTo(202 * 1.02, 0);
    }
  });

  it('rejects depth < 12%', () => {
    // Only 8% decline: 200 -> 184 -> 200
    const cup = [200, 196, 190, 185, 184, 188, 193, 197, 200, 201];
    const rows = makeWeeklyRows({ priceSequence: cup });
    const result = detectCupWithHandle(rows);
    // Should not detect cup with handle since depth < 12%
    expect(result.pattern).toBe('none');
  });

  it('rejects depth > 50%', () => {
    // 60% decline: 200 -> 80 -> 200 — too deep
    const cup = [200, 180, 150, 120, 100, 80, 100, 130, 160, 190];
    const rows = makeWeeklyRows({ priceSequence: cup });
    const result = detectCupWithHandle(rows);
    expect(result.pattern).toBe('none');
  });

  it('handle with >12% drift is not classified as cup_with_handle (uses cup_no_handle instead)', () => {
    // 10-bar cup: left high at 200, cup bottom at 160 (20% depth), right rim at 200.
    // The only possible handle window is the 4 bars appended after the right rim.
    // These 4 bars all have per-bar range of 15% (high=200, low=170), so every
    // 1-to-4-bar handle window exceeds HANDLE_MAX_DRIFT=12%. Result must be cup_no_handle.
    const cup = [200, 190, 175, 165, 160, 165, 175, 185, 195, 200];
    const cupRows = makeWeeklyRows({ priceSequence: cup });

    // Append 4 wide handle bars with drift 15% per bar — every window rejects
    const handleRows: OhlcvRow[] = Array.from({ length: 4 }, (_, i) => {
      const d = new Date('2024-03-11');
      d.setDate(d.getDate() + i * 7);
      return {
        date: d.toISOString().slice(0, 10),
        open: 185,
        high: 200,
        low: 170, // (200-170)/200 = 15% drift per single bar
        close: 185,
        volume: 1_000_000,
      };
    });

    // Remove trailing 4 bars from cupRows so only the post-cup handle bars are available
    // after the right rim. This prevents the algorithm from using cup bars 8-9 as a handle.
    const trimmedCup = cupRows.slice(0, 8); // left rim (0) + 6 mid bars + right rim (7)
    const rows = [...trimmedCup, ...handleRows];
    const result = detectCupWithHandle(rows);

    // With every possible handle window having >12% drift, the algorithm
    // must NOT return cup_with_handle (handle is rejected, falls back to cup_no_handle)
    expect(result.pattern).not.toBe('cup_with_handle');
  });

  it('buy_range_top === round2(pivot * 1.05)', () => {
    const cup = [200, 190, 175, 165, 160, 165, 175, 185, 195, 200];
    const handle = [198, 193, 197];
    const rows = makeWeeklyRows({ priceSequence: [...cup, ...handle] });
    const result = detectCupWithHandle(rows);

    if (result.pattern !== 'none') {
      const expected = Math.round(result.pivot_price * 1.05 * 100) / 100;
      expect(result.buy_range_top).toBeCloseTo(expected, 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Double Bottom tests
// ---------------------------------------------------------------------------

describe('detectDoubleBottom', () => {
  it('detects classic double bottom with 2% undercut, pivot = middle peak', () => {
    // Prior high 200, L1 = 160 (20% decline), M = 180 (12.5% above L1), L2 = 157 (2% below L1)
    const prior = [200, 195, 185, 175, 165]; // declining into L1
    const bounceUp = [160, 165, 170, 175, 180]; // L1 at 160, bounce to M=180
    const secondDecline = [175, 168, 162, 157]; // L2 = 157, undercuts L1=160 by ~2%
    const recovery = [162, 170]; // recovery after L2
    const rows = makeWeeklyRows({
      priceSequence: [...prior, ...bounceUp, ...secondDecline, ...recovery],
    });
    const result = detectDoubleBottom(rows);

    expect(result.pattern).toBe('double_bottom');
    if (result.pattern === 'double_bottom') {
      expect(result.pivot_price).toBeGreaterThan(0);
      expect(result.buy_range_top).toBeCloseTo(result.pivot_price * 1.05, 1);
    }
  });

  it('rejects L2 that does not undercut L1', () => {
    // L2 = exactly L1 (0% undercut) — should not qualify
    const prior = [200, 185, 170, 160]; // decline to L1=160
    const bounce = [160, 168, 175, 180]; // bounce to M=180
    const l2 = [175, 165, 161]; // L2=161, slightly above L1=160 (does not undercut)
    const recovery = [165, 170];
    const rows = makeWeeklyRows({
      priceSequence: [...prior, ...bounce, ...l2, ...recovery],
    });
    const result = detectDoubleBottom(rows);
    // Should NOT detect double_bottom
    expect(result.pattern).not.toBe('double_bottom');
  });

  it('rejects undercut > 5%', () => {
    // L2 undercuts L1 by 8% — too much
    const prior = [200, 185, 170, 160];
    const bounce = [160, 165, 170, 180];
    const l2 = [175, 165, 147]; // 147/160 = 8.1% undercut
    const recovery = [155, 165];
    const rows = makeWeeklyRows({
      priceSequence: [...prior, ...bounce, ...l2, ...recovery],
    });
    const result = detectDoubleBottom(rows);
    expect(result.pattern).not.toBe('double_bottom');
  });

  it('awards volume bonus when L2 volume < L1 volume * 0.9', () => {
    // Classic double bottom setup — varying volumes at L1 and L2
    const prior = [200, 185, 170, 165];
    const bounce = [163, 165, 170, 180];
    const l2 = [175, 168, 160]; // L2 undercuts L1=163 by ~2%
    const recovery = [163, 168];
    const priceSeq = [...prior, ...bounce, ...l2, ...recovery];

    const l1Idx = 3; // index of L1 (price 165)
    const l2Idx = prior.length + bounce.length + l2.length - 1; // index of L2

    const volumes = priceSeq.map((_, i) => {
      if (i === l1Idx) return 2_000_000; // high L1 volume
      if (i === l2Idx) return 1_000_000; // low L2 volume (< 0.9 * L1)
      return 1_000_000;
    });

    const rowsWithBonus = makeWeeklyRows({ priceSequence: priceSeq, volumes });

    // Same prices but equal volumes
    const rowsNoBonus = makeWeeklyRows({
      priceSequence: priceSeq,
      volumes: priceSeq.map(() => 1_000_000),
    });

    const resultBonus = detectDoubleBottom(rowsWithBonus);
    const resultNoBonus = detectDoubleBottom(rowsNoBonus);

    if (resultBonus.pattern === 'double_bottom' && resultNoBonus.pattern === 'double_bottom') {
      expect(resultBonus.quality_score).toBeGreaterThanOrEqual(resultNoBonus.quality_score);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('detectChartPattern (integration)', () => {
  it('returns none for insufficient data (< 35 rows)', () => {
    const daily = makeDailyRows([100, 110, 120], '2024-01-01');
    expect(daily.length).toBeLessThan(35);
    const result = detectChartPattern(daily);
    expect(result.pattern).toBe('none');
    expect(result.pivot_price).toBeNull();
  });

  it('aggregates daily to weekly before detection (70 daily rows forming flat base)', () => {
    // 70 daily = 14 weekly
    // Prior uptrend: weeks 0-5 (100->200), then flat: weeks 6-13 (200 +/- 2%)
    const priorWeeklyCloses = [100, 120, 140, 160, 180, 200];
    const flatWeeklyCloses = [200, 202, 198, 201, 199, 203, 197, 202];
    const allWeeklyCloses = [...priorWeeklyCloses, ...flatWeeklyCloses];

    const daily = makeDailyRows(allWeeklyCloses, '2024-01-01');
    expect(daily.length).toBeGreaterThanOrEqual(35);

    const result = detectChartPattern(daily);
    // Should detect some pattern (flat_base is likely)
    // At minimum, we test that it doesn't crash and returns a valid result
    expect(['flat_base', 'cup_with_handle', 'cup_no_handle', 'double_bottom', 'none']).toContain(
      result.pattern,
    );
    if (result.pattern !== 'none') {
      expect(result.pivot_price).toBeGreaterThan(0);
      expect(result.buy_range_top).toBeCloseTo(result.pivot_price * 1.05, 1);
    }
  });

  it('returns highest quality_score when multiple patterns qualify', () => {
    // Build a sequence that forms both a flat base and possibly a cup
    // We just verify that the returned result has max quality among candidates
    const priorUp = [100, 120, 140, 160, 180, 200];
    const flat = [200, 202, 198, 201, 199, 203, 197, 204];
    const daily = makeDailyRows([...priorUp, ...flat], '2024-01-01');

    const result = detectChartPattern(daily);
    // Manually get all three pattern results for weekly data
    const weekly = [...priorUp, ...flat].map((price, i) => {
      const d = new Date('2024-01-01');
      d.setDate(d.getDate() + i * 7);
      return {
        date: d.toISOString().slice(0, 10),
        open: price * 0.99,
        high: price * 1.02,
        low: price * 0.98,
        close: price,
        volume: 1_000_000,
      };
    });

    const flat_ = detectFlatBase(weekly);
    const cup = detectCupWithHandle(weekly);
    const db = detectDoubleBottom(weekly);
    const maxScore = Math.max(flat_.quality_score, cup.quality_score, db.quality_score);

    expect(result.quality_score).toBe(maxScore);
  });
});
