import type { OhlcvRow } from './indicators';
import { aggregateToWeekly } from './indicators';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PatternName =
  | 'cup_with_handle'
  | 'cup_no_handle'
  | 'double_bottom'
  | 'flat_base'
  | 'none';

export interface BasePattern {
  pattern: PatternName;
  pivot_price: number;
  buy_range_top: number; // pivot x 1.05
  base_start_date: string; // YYYY-MM-DD
  base_end_date: string;
  base_length_weeks: number;
  depth_pct: number;
  quality_score: number; // 0-100
  quality_notes: string[];
}

export interface NullPattern {
  pattern: 'none';
  pivot_price: null;
  buy_range_top: null;
  base_start_date: null;
  base_end_date: null;
  base_length_weeks: 0;
  depth_pct: 0;
  quality_score: 0;
  quality_notes: string[];
}

export type PatternResult = BasePattern | NullPattern;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUP_MIN_WEEKS = 6;
const CUP_MAX_WEEKS = 65;
const CUP_MIN_DEPTH = 0.12;
const CUP_MAX_DEPTH = 0.5;
const CUP_RECOVERY_THRESHOLD = 0.9;
const HANDLE_MIN_WEEKS = 1;
const HANDLE_MAX_WEEKS = 8;
const HANDLE_MAX_DRIFT = 0.12;
const HANDLE_MAX_WIDTH_RATIO = 0.5;
const DB_MIN_WEEKS = 7;
const DB_MAX_WEEKS = 60;
const DB_FIRST_LOW_DECLINE = 0.12;
const DB_SECOND_LOW_UNDERCUT = 0.005;
const DB_SECOND_LOW_MAX_UNDERCUT = 0.05;
const DB_MIDDLE_BOUNCE = 0.08;
const FLAT_MIN_WEEKS = 5;
const FLAT_MAX_WEEKS = 20;
const FLAT_MAX_RANGE = 0.15;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function maxHigh(rows: OhlcvRow[], from: number, to: number): number {
  let max = -Infinity;
  for (let i = from; i <= to; i++) {
    const h = rows[i]?.high ?? -Infinity;
    if (h > max) max = h;
  }
  return max;
}

function isLocalMin(weekly: OhlcvRow[], idx: number, window: number): boolean {
  const low = weekly[idx]?.low ?? Infinity;
  for (let i = Math.max(0, idx - window); i <= Math.min(weekly.length - 1, idx + window); i++) {
    if (i !== idx && (weekly[i]?.low ?? Infinity) < low) return false;
  }
  return true;
}

function isLocalMax(weekly: OhlcvRow[], idx: number, window: number): boolean {
  const high = weekly[idx]?.high ?? -Infinity;
  for (let i = Math.max(0, idx - window); i <= Math.min(weekly.length - 1, idx + window); i++) {
    if (i !== idx && (weekly[i]?.high ?? -Infinity) > high) return false;
  }
  return true;
}

interface HandleResult {
  pivotPrice: number;
  handleEndIdx: number;
  drift: number;
  isVolumeContraction: boolean;
}

function findHandle(
  weekly: OhlcvRow[],
  rimIdx: number,
  handleStart: number,
  handleEnd: number,
  leftHigh: number,
): HandleResult | null {
  const rimHigh = weekly[rimIdx]?.high ?? 0;
  if (rimHigh <= 0) return null;

  // Handle window: handleStart to handleEnd (inclusive)
  if (handleStart > handleEnd) return null;
  const handleLen = handleEnd - handleStart + 1;
  if (handleLen < HANDLE_MIN_WEEKS || handleLen > HANDLE_MAX_WEEKS) return null;
  if (handleLen > (rimIdx - 0) * HANDLE_MAX_WIDTH_RATIO) return null; // handle too wide relative to cup

  // Pivot is highest high in the handle
  let pivotPrice = -Infinity;
  let pivotIdx = handleStart;
  for (let i = handleStart; i <= handleEnd; i++) {
    const h = weekly[i]?.high ?? 0;
    if (h > pivotPrice) {
      pivotPrice = h;
      pivotIdx = i;
    }
  }

  // Drift: how far does the handle drop from its own highest point?
  let handleLow = Infinity;
  for (let i = handleStart; i <= handleEnd; i++) {
    const l = weekly[i]?.low ?? Infinity;
    if (l < handleLow) handleLow = l;
  }

  const handleHighForDrift = weekly[pivotIdx]?.high ?? pivotPrice;
  const drift = handleHighForDrift > 0 ? (handleHighForDrift - handleLow) / handleHighForDrift : 0;
  if (drift > HANDLE_MAX_DRIFT) return null;

  // Handle must not exceed left-side high
  if (pivotPrice > leftHigh) return null;

  // Volume contraction: avg handle volume < avg cup right side volume
  const handleVolumes = weekly.slice(handleStart, handleEnd + 1).map((r) => r.volume);
  const cupRightStart = Math.max(0, rimIdx - (handleEnd - handleStart + 1));
  const cupRightVolumes = weekly.slice(cupRightStart, rimIdx).map((r) => r.volume);
  const isVolumeContraction =
    cupRightVolumes.length > 0 && avg(handleVolumes) < avg(cupRightVolumes) * 0.9;

  return {
    pivotPrice: round2(pivotPrice),
    handleEndIdx: handleEnd,
    drift,
    isVolumeContraction,
  };
}

// ---------------------------------------------------------------------------
// Flat Base
// ---------------------------------------------------------------------------

export function detectFlatBase(weekly: OhlcvRow[]): PatternResult {
  const n = weekly.length;
  if (n < FLAT_MIN_WEEKS) return nullPattern();

  // Try windows ending at the latest bar, working backwards for the longest valid base
  let best: PatternResult = nullPattern();

  for (let end = n - 1; end >= FLAT_MIN_WEEKS - 1; end--) {
    for (
      let start = Math.max(0, end - FLAT_MAX_WEEKS + 1);
      start <= end - FLAT_MIN_WEEKS + 1;
      start++
    ) {
      const length = end - start + 1;
      if (length < FLAT_MIN_WEEKS || length > FLAT_MAX_WEEKS) continue;

      // Compute range
      let high = -Infinity;
      let low = Infinity;
      for (let i = start; i <= end; i++) {
        const h = weekly[i]?.high ?? -Infinity;
        const l = weekly[i]?.low ?? Infinity;
        if (h > high) high = h;
        if (l < low) low = l;
      }
      if (high <= 0) continue;

      const range = (high - low) / high;
      if (range > FLAT_MAX_RANGE) continue;

      // Prior advance: price before base start must be >= 20% below base start close
      const priorClose = weekly[start - 1]?.close ?? 0;
      const baseStartClose = weekly[start]?.close ?? 0;
      if (start === 0 || priorClose <= 0 || baseStartClose <= 0) continue;

      // Look back up to 52 weeks for prior advance
      const lookbackStart = Math.max(0, start - 52);
      let priorLow = Infinity;
      for (let i = lookbackStart; i < start; i++) {
        const l = weekly[i]?.low ?? Infinity;
        if (l < priorLow) priorLow = l;
      }
      if (priorLow <= 0 || priorLow === Infinity) continue;
      const priorAdvance = (baseStartClose - priorLow) / priorLow;
      if (priorAdvance < 0.2) continue;

      // Quality scoring
      let score = 50;
      const notes: string[] = [];

      if (range < 0.08) {
        score += 20;
        notes.push('range <8%');
      } else if (range < 0.12) {
        score += 10;
        notes.push('range 8-12%');
      }

      if (length >= 8) {
        score += 10;
        notes.push('base >=8 weeks');
      }

      // Volume contraction vs prior period
      const baseVolumes = weekly.slice(start, end + 1).map((r) => r.volume);
      const priorStart = Math.max(0, start - length);
      const priorVolumes = weekly.slice(priorStart, start).map((r) => r.volume);
      if (priorVolumes.length > 0 && avg(baseVolumes) < avg(priorVolumes) * 0.85) {
        score += 15;
        notes.push('volume contracting');
      }

      // Last close within 3% of pivot (highest high)
      const lastClose = weekly[end]?.close ?? 0;
      if (lastClose > 0 && (high - lastClose) / high <= 0.03) {
        score += 10;
        notes.push('close near pivot');
      }

      score = Math.min(100, score);

      if (score > (best.pattern === 'none' ? -1 : best.quality_score)) {
        best = {
          pattern: 'flat_base',
          pivot_price: round2(high),
          buy_range_top: round2(high * 1.05),
          base_start_date: weekly[start]?.date ?? '',
          base_end_date: weekly[end]?.date ?? '',
          base_length_weeks: length,
          depth_pct: round2(range * 100),
          quality_score: score,
          quality_notes: notes,
        };
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Cup with Handle
// ---------------------------------------------------------------------------

export function detectCupWithHandle(weekly: OhlcvRow[], volAvg20 = 0): PatternResult {
  const n = weekly.length;
  if (n < CUP_MIN_WEEKS) return nullPattern();

  let best: PatternResult = nullPattern();

  // Scan for left-side high: try each bar as potential left rim
  for (let leftIdx = 0; leftIdx < n - CUP_MIN_WEEKS; leftIdx++) {
    if (!isLocalMax(weekly, leftIdx, 2)) continue;
    const leftHigh = weekly[leftIdx]?.high ?? 0;
    if (leftHigh <= 0) continue;

    // Search for right rim: must be within CUP_MIN_WEEKS..CUP_MAX_WEEKS of leftIdx
    for (
      let rightIdx = leftIdx + CUP_MIN_WEEKS;
      rightIdx < Math.min(n, leftIdx + CUP_MAX_WEEKS + 1);
      rightIdx++
    ) {
      const rightHigh = weekly[rightIdx]?.high ?? 0;

      // Right rim must recover to >= 90% of left high
      if (rightHigh < leftHigh * CUP_RECOVERY_THRESHOLD) continue;

      // Find the cup low (lowest low between left and right rim)
      let cupLow = Infinity;
      let cupLowIdx = leftIdx + 1;
      for (let i = leftIdx + 1; i < rightIdx; i++) {
        const l = weekly[i]?.low ?? Infinity;
        if (l < cupLow) {
          cupLow = l;
          cupLowIdx = i;
        }
      }
      if (cupLow === Infinity) continue;

      // Depth check: 12-50%
      const depth = (leftHigh - cupLow) / leftHigh;
      if (depth < CUP_MIN_DEPTH || depth > CUP_MAX_DEPTH) continue;

      const cupLengthWeeks = rightIdx - leftIdx;

      // Try to find a handle after the right rim
      let result: PatternResult | null = null;

      // Handle window: 1-8 weeks after right rim
      for (
        let handleEnd = rightIdx + HANDLE_MAX_WEEKS;
        handleEnd >= rightIdx + HANDLE_MIN_WEEKS;
        handleEnd--
      ) {
        if (handleEnd >= n) continue;
        const handle = findHandle(weekly, rightIdx, rightIdx + 1, handleEnd, leftHigh);
        if (handle && handle.drift <= HANDLE_MAX_DRIFT) {
          // Cup with handle found
          let score = 50;
          const notes: string[] = [];

          if (depth >= 0.2 && depth <= 0.35) {
            score += 20;
            notes.push('ideal depth 20-35%');
          }

          score += 15;
          notes.push('handle present');

          if (handle.isVolumeContraction) {
            score += 10;
            notes.push('handle volume contracting');
          }

          if (handle.drift <= 0.06) {
            score += 5;
            notes.push('handle drift <=6%');
          }

          // Symmetric shape: cup low near midpoint
          const midIdx = Math.round((leftIdx + rightIdx) / 2);
          if (Math.abs(cupLowIdx - midIdx) <= 2) {
            score += 10;
            notes.push('symmetric cup');
          }

          // Right side volume > left side volume
          const midBar = Math.round((leftIdx + rightIdx) / 2);
          const leftVol = avg(weekly.slice(leftIdx + 1, midBar + 1).map((r) => r.volume));
          const rightVol = avg(weekly.slice(midBar + 1, rightIdx + 1).map((r) => r.volume));
          if (rightVol > leftVol) {
            score += 10;
            notes.push('right side volume > left side');
          }

          score = Math.min(100, score);

          const currentResult = result as PatternResult | null;
          const prevBestScore =
            currentResult === null || currentResult.pattern === 'none'
              ? -1
              : currentResult.quality_score;
          if (score > prevBestScore) {
            result = {
              pattern: 'cup_with_handle',
              pivot_price: handle.pivotPrice,
              buy_range_top: round2(handle.pivotPrice * 1.05),
              base_start_date: weekly[leftIdx]?.date ?? '',
              base_end_date: weekly[handle.handleEndIdx]?.date ?? '',
              base_length_weeks: handle.handleEndIdx - leftIdx + 1,
              depth_pct: round2(depth * 100),
              quality_score: score,
              quality_notes: notes,
            };
          }
          break; // found a valid handle, use it
        }
      }

      // Cup without handle: right rim is the pivot
      const noHandleScore = (() => {
        let score = 50;
        const notes: string[] = [];

        if (depth >= 0.2 && depth <= 0.35) {
          score += 20;
          notes.push('ideal depth 20-35%');
        }

        // Symmetric shape
        const midIdx = Math.round((leftIdx + rightIdx) / 2);
        if (Math.abs(cupLowIdx - midIdx) <= 2) {
          score += 10;
          notes.push('symmetric cup');
        }

        // Right side volume > left side
        const midBar = Math.round((leftIdx + rightIdx) / 2);
        const leftVol = avg(weekly.slice(leftIdx + 1, midBar + 1).map((r) => r.volume));
        const rightVol = avg(weekly.slice(midBar + 1, rightIdx + 1).map((r) => r.volume));
        if (rightVol > leftVol) {
          score += 10;
          notes.push('right side volume > left side');
        }

        score = Math.min(100, score);
        return { score, notes };
      })();

      const noHandleResult: BasePattern = {
        pattern: 'cup_no_handle',
        pivot_price: round2(rightHigh),
        buy_range_top: round2(rightHigh * 1.05),
        base_start_date: weekly[leftIdx]?.date ?? '',
        base_end_date: weekly[rightIdx]?.date ?? '',
        base_length_weeks: cupLengthWeeks,
        depth_pct: round2(depth * 100),
        quality_score: noHandleScore.score,
        quality_notes: noHandleScore.notes,
      };

      // Pick best: cup_with_handle wins if it has higher score, else cup_no_handle
      const candidate =
        result !== null &&
        result.pattern !== 'none' &&
        (result as BasePattern).quality_score >= noHandleResult.quality_score
          ? result
          : noHandleResult;

      const bestScore = best.pattern === 'none' ? -1 : (best as BasePattern).quality_score;
      const candidateScore =
        candidate.pattern === 'none' ? -1 : (candidate as BasePattern).quality_score;
      if (candidateScore > bestScore) {
        best = candidate;
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Double Bottom
// ---------------------------------------------------------------------------

export function detectDoubleBottom(weekly: OhlcvRow[], volAvg20 = 0): PatternResult {
  const n = weekly.length;
  if (n < DB_MIN_WEEKS) return nullPattern();

  let best: PatternResult = nullPattern();

  // Scan for L1: first bottom
  for (let l1Idx = 1; l1Idx < n - DB_MIN_WEEKS + 1; l1Idx++) {
    if (!isLocalMin(weekly, l1Idx, 2)) continue;
    const l1Low = weekly[l1Idx]?.low ?? Infinity;
    if (l1Low === Infinity || l1Low <= 0) continue;

    // Prior decline into L1: need >= 12% decline from some prior high
    const lookback = Math.min(l1Idx, 26);
    let priorHigh = -Infinity;
    for (let i = Math.max(0, l1Idx - lookback); i < l1Idx; i++) {
      const h = weekly[i]?.high ?? -Infinity;
      if (h > priorHigh) priorHigh = h;
    }
    if (priorHigh <= 0) continue;
    const firstDecline = (priorHigh - l1Low) / priorHigh;
    if (firstDecline < DB_FIRST_LOW_DECLINE) continue;

    // Search for middle peak M between L1 and L2
    for (let mIdx = l1Idx + 1; mIdx < n - 1; mIdx++) {
      const mHigh = weekly[mIdx]?.high ?? 0;
      if (mHigh < l1Low * (1 + DB_MIDDLE_BOUNCE)) continue; // M must be >= 8% above L1

      // Search for L2 after M
      for (let l2Idx = mIdx + 1; l2Idx < Math.min(n, l1Idx + DB_MAX_WEEKS); l2Idx++) {
        const totalWeeks = l2Idx - l1Idx + 1;
        if (totalWeeks > DB_MAX_WEEKS) break;
        if (totalWeeks < DB_MIN_WEEKS) continue;

        const l2Low = weekly[l2Idx]?.low ?? Infinity;
        if (l2Low === Infinity) continue;

        // L2 must undercut L1 by 0.5-5%
        const undercut = (l1Low - l2Low) / l1Low;
        if (undercut < DB_SECOND_LOW_UNDERCUT || undercut > DB_SECOND_LOW_MAX_UNDERCUT) continue;

        // L2 must be a local minimum
        if (!isLocalMin(weekly, l2Idx, 2)) continue;

        // Recovery from L2: next bar should be above L2 low (pattern complete)
        if (l2Idx + 1 >= n) continue;
        const recoveryClose = weekly[l2Idx + 1]?.close ?? 0;
        if (recoveryClose <= l2Low) continue;

        // Quality scoring
        let score = 50;
        const notes: string[] = [];

        if (undercut >= 0.01 && undercut <= 0.03) {
          score += 20;
          notes.push('ideal undercut 1-3%');
        }

        // L2 volume < L1 volume * 0.9
        const l1Vol = weekly[l1Idx]?.volume ?? 0;
        const l2Vol = weekly[l2Idx]?.volume ?? 0;
        if (l1Vol > 0 && l2Vol < l1Vol * 0.9) {
          score += 15;
          notes.push('L2 volume < L1 volume');
        }

        // Volume surge on recovery (bar after L2)
        const recoveryVol = weekly[l2Idx + 1]?.volume ?? 0;
        const avgVol = avg(weekly.slice(Math.max(0, l2Idx - 10), l2Idx).map((r) => r.volume));
        if (avgVol > 0 && recoveryVol > avgVol * 1.3) {
          score += 10;
          notes.push('volume surge on recovery');
        }

        // Depth 20-40%
        const totalDepth = (priorHigh - l2Low) / priorHigh;
        if (totalDepth >= 0.2 && totalDepth <= 0.4) {
          score += 10;
          notes.push('depth 20-40%');
        }

        // Last close within 5% of pivot (M)
        const lastClose = weekly[n - 1]?.close ?? 0;
        if (lastClose > 0 && mHigh > 0 && (mHigh - lastClose) / mHigh <= 0.05) {
          score += 10;
          notes.push('close within 5% of pivot');
        }

        score = Math.min(100, score);

        const bestScore = best.pattern === 'none' ? -1 : (best as BasePattern).quality_score;
        if (score > bestScore) {
          best = {
            pattern: 'double_bottom',
            pivot_price: round2(mHigh),
            buy_range_top: round2(mHigh * 1.05),
            base_start_date: weekly[l1Idx]?.date ?? '',
            base_end_date: weekly[l2Idx]?.date ?? '',
            base_length_weeks: totalWeeks,
            depth_pct: round2(totalDepth * 100),
            quality_score: score,
            quality_notes: notes,
          };
        }
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function detectChartPattern(dailyRows: OhlcvRow[], volAvg20 = 0): PatternResult {
  if (dailyRows.length < 35) return nullPattern();

  const weekly = aggregateToWeekly(dailyRows);

  const candidates: PatternResult[] = [
    detectFlatBase(weekly),
    detectCupWithHandle(weekly, volAvg20),
    detectDoubleBottom(weekly, volAvg20),
  ];

  let best: PatternResult = nullPattern();
  for (const c of candidates) {
    if (c.pattern === 'none') continue;
    if (best.pattern === 'none' || c.quality_score > best.quality_score) {
      best = c;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Null pattern factory
// ---------------------------------------------------------------------------

function nullPattern(): NullPattern {
  return {
    pattern: 'none',
    pivot_price: null,
    buy_range_top: null,
    base_start_date: null,
    base_end_date: null,
    base_length_weeks: 0,
    depth_pct: 0,
    quality_score: 0,
    quality_notes: [],
  };
}
