export function computeSma(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const result: number[] = [];
  let windowSum = closes.slice(0, period).reduce((a, b) => a + b, 0);
  result.push(windowSum / period);
  for (let i = period; i < closes.length; i++) {
    windowSum += (closes[i] ?? 0) - (closes[i - period] ?? 0);
    result.push(windowSum / period);
  }
  return result;
}

export function computeEma(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const multiplier = 2 / (period + 1);
  const seed = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [seed];
  for (let i = period; i < closes.length; i++) {
    result.push(
      (closes[i] ?? 0) * multiplier + (result[result.length - 1] ?? 0) * (1 - multiplier),
    );
  }
  return result;
}

export function computeRsi(closes: number[], period = 14): number[] {
  if (closes.length <= period) return [];

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push((closes[i] ?? 0) - (closes[i - 1] ?? 0));
  }

  // Seed: simple mean of first `period` gains/losses
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const c = changes[i] ?? 0;
    if (c > 0) avgGain += c;
    else avgLoss += Math.abs(c);
  }
  avgGain /= period;
  avgLoss /= period;

  const result: number[] = [];

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0));

  // Wilder's smoothing for remaining values
  for (let i = period; i < changes.length; i++) {
    const c = changes[i] ?? 0;
    const gain = c > 0 ? c : 0;
    const loss = c < 0 ? Math.abs(c) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }

  return result;
}

export function computeMacd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): Array<{ macd: number; signal: number; histogram: number }> {
  const fastEma = computeEma(closes, fast);
  const slowEma = computeEma(closes, slow);

  if (fastEma.length === 0 || slowEma.length === 0) return [];

  // Align: slowEma is shorter, take last slowEma.length values of fastEma
  const alignedFast = fastEma.slice(fastEma.length - slowEma.length);
  const macdLine = alignedFast.map((v, i) => v - (slowEma[i] ?? 0));

  const signalLine = computeEma(macdLine, signal);
  if (signalLine.length === 0) return [];

  // Align macdLine to signalLine length
  const alignedMacd = macdLine.slice(macdLine.length - signalLine.length);

  return alignedMacd.map((v, i) => ({
    macd: v,
    signal: signalLine[i] ?? 0,
    histogram: v - (signalLine[i] ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Phase 2 indicators
// ---------------------------------------------------------------------------

/**
 * Returns how many items to skip from the front of closes[] to align with result[].
 * closes[i + offset] corresponds to result[i].
 */
export function getOffset(closesLength: number, resultLength: number): number {
  return closesLength - resultLength;
}

/**
 * Wilder's ATR. Result length = closes.length - period. Offset = period.
 */
export function computeAtr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number[] {
  const n = closes.length;
  if (n <= period) return [];

  // Compute true ranges (index 1..n-1)
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    const pc = closes[i - 1] ?? 0;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  // trs has length n-1. We need at least `period` TRs for seed.
  if (trs.length < period) return [];

  // Seed: simple mean of first `period` TRs (trs[0..period-1])
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [atr];

  // Wilder smoothing for remaining TRs
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + (trs[i] ?? 0)) / period;
    result.push(atr);
  }

  // result.length = trs.length - period + 1 = (n-1) - period + 1 = n - period
  return result;
}

/**
 * Average Daily Range % = rolling mean of (high-low)/close*100 over `period` bars.
 * Result length = closes.length - period + 1. Offset = period - 1.
 */
export function computeAdr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number[] {
  const n = closes.length;
  if (n < period) return [];

  const dailyRanges: number[] = closes.map((c, i) => {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    return c === 0 ? 0 : ((h - l) / c) * 100;
  });

  const result: number[] = [];
  let windowSum = dailyRanges.slice(0, period).reduce((a, b) => a + b, 0);
  result.push(windowSum / period);
  for (let i = period; i < n; i++) {
    windowSum += (dailyRanges[i] ?? 0) - (dailyRanges[i - period] ?? 0);
    result.push(windowSum / period);
  }
  return result;
}

/**
 * Bollinger Bands. Result length = closes.length - period + 1. Offset = period - 1.
 */
export function computeBollingerBands(
  closes: number[],
  period = 20,
  multiplier = 2,
): Array<{ upper: number; middle: number; lower: number; width: number }> {
  const n = closes.length;
  if (n < period) return [];

  const result: Array<{ upper: number; middle: number; lower: number; width: number }> = [];

  for (let i = period - 1; i < n; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const stddev = Math.sqrt(variance);
    const upper = mean + multiplier * stddev;
    const lower = mean - multiplier * stddev;
    result.push({ upper, middle: mean, lower, width: upper - lower });
  }

  return result;
}

/**
 * Keltner Channels. Aligns EMA(period) with ATR(period).
 * EMA offset = period-1, ATR offset = period. Takes last min(ema.length, atr.length) of each.
 */
export function computeKeltnerChannels(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
  atrMult = 2,
): Array<{ upper: number; lower: number; middle: number }> {
  const ema = computeEma(closes, period);
  const atr = computeAtr(highs, lows, closes, period);

  if (ema.length === 0 || atr.length === 0) return [];

  const len = Math.min(ema.length, atr.length);
  const alignedEma = ema.slice(ema.length - len);
  const alignedAtr = atr.slice(atr.length - len);

  return alignedEma.map((middle, i) => {
    const a = alignedAtr[i] ?? 0;
    return {
      middle,
      upper: middle + atrMult * a,
      lower: middle - atrMult * a,
    };
  });
}

/**
 * Donchian Channels. Result length = highs.length - period + 1. Offset = period - 1.
 */
export function computeDonchian(
  highs: number[],
  lows: number[],
  period = 20,
): Array<{ upper: number; lower: number }> {
  const n = highs.length;
  if (n < period) return [];

  const result: Array<{ upper: number; lower: number }> = [];
  for (let i = period - 1; i < n; i++) {
    const hWindow = highs.slice(i - period + 1, i + 1);
    const lWindow = lows.slice(i - period + 1, i + 1);
    result.push({
      upper: Math.max(...hWindow),
      lower: Math.min(...lWindow),
    });
  }
  return result;
}

/**
 * Daily VWAP approximation. Result length = closes.length. Offset = 0.
 * closedAbove: 1 if close > vwap, 0 otherwise.
 */
export function computeVwap(
  highs: number[],
  lows: number[],
  closes: number[],
  _volumes: number[],
): Array<{ vwap: number; closedAbove: number }> {
  return closes.map((close, i) => {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    const vwap = (h + l + close) / 3;
    // close > (H+L+C)/3 ↔ 2*close > H+L
    const closedAbove = 2 * close > h + l ? 1 : 0;
    return { vwap, closedAbove };
  });
}

/**
 * Stochastic Oscillator.
 * %K_raw length = N - kPeriod + 1
 * %K (smoothed) length = N - kPeriod - smooth + 2
 * %D length = N - kPeriod - smooth - 1
 */
export function computeStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  smooth = 3,
): Array<{ k: number; d: number }> {
  const n = closes.length;
  if (n < kPeriod) return [];

  // Compute raw %K
  const kRaw: number[] = [];
  for (let i = kPeriod - 1; i < n; i++) {
    const hWindow = highs.slice(i - kPeriod + 1, i + 1);
    const lWindow = lows.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...hWindow);
    const ll = Math.min(...lWindow);
    if (hh === ll) {
      kRaw.push(50);
    } else {
      kRaw.push((((closes[i] ?? 0) - ll) / (hh - ll)) * 100);
    }
  }

  // Smooth %K with SMA(smooth)
  const kSmoothed = computeSma(kRaw, smooth);
  if (kSmoothed.length === 0) return [];

  // %D = SMA(kSmoothed, 3)
  const dLine = computeSma(kSmoothed, 3);
  if (dLine.length === 0) return [];

  // Align kSmoothed to dLine length
  const alignedK = kSmoothed.slice(kSmoothed.length - dLine.length);

  return alignedK.map((k, i) => ({ k, d: dLine[i] ?? 0 }));
}

/**
 * Commodity Channel Index.
 * Result length = N - period + 1. Offset = period - 1.
 */
export function computeCci(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
): number[] {
  const n = closes.length;
  if (n < period) return [];

  const tp = closes.map((c, i) => ((highs[i] ?? 0) + (lows[i] ?? 0) + c) / 3);
  const result: number[] = [];

  for (let i = period - 1; i < n; i++) {
    const window = tp.slice(i - period + 1, i + 1);
    const meanTp = window.reduce((a, b) => a + b, 0) / period;
    const meanDev = window.reduce((a, b) => a + Math.abs(b - meanTp), 0) / period;
    if (meanDev === 0) {
      result.push(0);
    } else {
      result.push((tp[i] ?? 0 - meanTp) / (0.015 * meanDev));
    }
  }

  return result;
}

/**
 * Williams %R.
 * Result length = N - period + 1. Offset = period - 1.
 */
export function computeWilliamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number[] {
  const n = closes.length;
  if (n < period) return [];

  const result: number[] = [];
  for (let i = period - 1; i < n; i++) {
    const hWindow = highs.slice(i - period + 1, i + 1);
    const lWindow = lows.slice(i - period + 1, i + 1);
    const hh = Math.max(...hWindow);
    const ll = Math.min(...lWindow);
    if (hh === ll) {
      result.push(-50);
    } else {
      result.push(((hh - (closes[i] ?? 0)) / (hh - ll)) * -100);
    }
  }
  return result;
}

/**
 * ADX with +DI and -DI using Wilder's smoothing.
 * Result length = closes.length - 2*period + 1. Offset = 2*period - 1.
 */
export function computeAdx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): Array<{ adx: number; diPlus: number; diMinus: number }> {
  const n = closes.length;
  if (n < 2 * period) return [];

  // Step 1: compute TR, +DM, -DM for bars 1..n-1
  const trs: number[] = [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];

  for (let i = 1; i < n; i++) {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    const ph = highs[i - 1] ?? 0;
    const pl = lows[i - 1] ?? 0;
    const pc = closes[i - 1] ?? 0;

    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const upMove = h - ph;
    const downMove = pl - l;

    trs.push(tr);
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Step 2: seed at bar `period` (using trs[0..period-1])
  let tr14 = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let dm14plus = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let dm14minus = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const computeDiDx = (
    tr: number,
    dmp: number,
    dmm: number,
  ): { diPlus: number; diMinus: number; dx: number } => {
    const diPlus = tr === 0 ? 0 : (dmp / tr) * 100;
    const diMinus = tr === 0 ? 0 : (dmm / tr) * 100;
    const dxDenom = diPlus + diMinus;
    const dx = dxDenom === 0 ? 0 : (Math.abs(diPlus - diMinus) / dxDenom) * 100;
    return { diPlus, diMinus, dx };
  };

  // Collect DX values and DI values for seeding ADX
  const dxValues: number[] = [];
  const diPlusValues: number[] = [];
  const diMinusValues: number[] = [];

  const seed0 = computeDiDx(tr14, dm14plus, dm14minus);
  dxValues.push(seed0.dx);
  diPlusValues.push(seed0.diPlus);
  diMinusValues.push(seed0.diMinus);

  // Roll forward from trs[period] onward
  for (let i = period; i < trs.length; i++) {
    tr14 = tr14 - tr14 / period + (trs[i] ?? 0);
    dm14plus = dm14plus - dm14plus / period + (dmPlus[i] ?? 0);
    dm14minus = dm14minus - dm14minus / period + (dmMinus[i] ?? 0);
    const { diPlus, diMinus, dx } = computeDiDx(tr14, dm14plus, dm14minus);
    dxValues.push(dx);
    diPlusValues.push(diPlus);
    diMinusValues.push(diMinus);
  }

  // dxValues.length = trs.length - period + 1 = (n-1) - period + 1 = n - period
  // We need at least `period` DX values to seed ADX
  if (dxValues.length < period) return [];

  // Seed ADX = mean of first `period` DX values
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: Array<{ adx: number; diPlus: number; diMinus: number }> = [];

  result.push({
    adx,
    diPlus: diPlusValues[period - 1] ?? 0,
    diMinus: diMinusValues[period - 1] ?? 0,
  });

  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + (dxValues[i] ?? 0)) / period;
    result.push({
      adx,
      diPlus: diPlusValues[i] ?? 0,
      diMinus: diMinusValues[i] ?? 0,
    });
  }

  // result.length = dxValues.length - period + 1 = (n - period) - period + 1 = n - 2*period + 1
  return result;
}

/**
 * Parabolic SAR.
 * Result length = closes.length - 1. Offset = 1.
 * signal: 1 = bullish, -1 = bearish.
 */
export function computePsar(
  highs: number[],
  lows: number[],
  closes: number[],
  initialAf = 0.02,
  maxAf = 0.2,
): Array<{ psar: number; signal: number }> {
  const n = closes.length;
  if (n < 2) return [];

  // Initialize from bar 1
  let direction = (closes[1] ?? 0) >= (closes[0] ?? 0) ? 1 : -1;
  let sar: number;
  let ep: number;
  let af = initialAf;

  if (direction === 1) {
    sar = lows[0] ?? 0;
    ep = highs[1] ?? 0;
  } else {
    sar = highs[0] ?? 0;
    ep = lows[1] ?? 0;
  }

  const result: Array<{ psar: number; signal: number }> = [];
  // First result is the initialized state at bar 1
  result.push({ psar: sar, signal: direction });

  for (let i = 2; i < n; i++) {
    const prevSar = sar;
    const prevEp = ep;
    const prevAf = af;

    if (direction === 1) {
      let newSar = prevSar + prevAf * (prevEp - prevSar);
      // PSAR must not be above prior two lows
      newSar = Math.min(newSar, lows[i - 1] ?? newSar);
      if (i >= 2) newSar = Math.min(newSar, lows[i - 2] ?? newSar);

      if ((lows[i] ?? 0) < newSar) {
        // Reversal to bearish
        direction = -1;
        sar = prevEp;
        ep = lows[i] ?? 0;
        af = initialAf;
      } else {
        sar = newSar;
        if ((highs[i] ?? 0) > prevEp) {
          ep = highs[i] ?? 0;
          af = Math.min(prevAf + initialAf, maxAf);
        }
      }
    } else {
      let newSar = prevSar - prevAf * (prevSar - prevEp);
      // PSAR must not be below prior two highs
      newSar = Math.max(newSar, highs[i - 1] ?? newSar);
      if (i >= 2) newSar = Math.max(newSar, highs[i - 2] ?? newSar);

      if ((highs[i] ?? 0) > newSar) {
        // Reversal to bullish
        direction = 1;
        sar = prevEp;
        ep = highs[i] ?? 0;
        af = initialAf;
      } else {
        sar = newSar;
        if ((lows[i] ?? 0) < prevEp) {
          ep = lows[i] ?? 0;
          af = Math.min(prevAf + initialAf, maxAf);
        }
      }
    }

    result.push({ psar: sar, signal: direction });
  }

  return result;
}

/**
 * Rate of Change.
 * Result length = closes.length - period. Offset = period.
 */
export function computeRoc(closes: number[], period = 5): number[] {
  const n = closes.length;
  if (n <= period) return [];

  const result: number[] = [];
  for (let i = period; i < n; i++) {
    const prev = closes[i - period] ?? 0;
    result.push(prev === 0 ? 0 : (((closes[i] ?? 0) - prev) / prev) * 100);
  }
  return result;
}

/**
 * On-Balance Volume.
 * Result length = closes.length. Offset = 0.
 */
export function computeObv(closes: number[], volumes: number[]): number[] {
  const n = closes.length;
  if (n === 0) return [];

  const result: number[] = [volumes[0] ?? 0];
  for (let i = 1; i < n; i++) {
    const prev = result[result.length - 1] ?? 0;
    const c = closes[i] ?? 0;
    const pc = closes[i - 1] ?? 0;
    const v = volumes[i] ?? 0;
    if (c > pc) result.push(prev + v);
    else if (c < pc) result.push(prev - v);
    else result.push(prev);
  }
  return result;
}

/**
 * OBV Slope.
 * slope[i] = (obv[i] - obv[i-period]) / Math.abs(obv[i-period] || 1)
 * Result length = obv.length - period. Offset = period.
 */
export function computeObvSlope(obv: number[], period = 5): number[] {
  const n = obv.length;
  if (n <= period) return [];

  const result: number[] = [];
  for (let i = period; i < n; i++) {
    const prev = obv[i - period] ?? 0;
    result.push(prev === 0 ? 0 : ((obv[i] ?? 0) - prev) / Math.abs(prev));
  }
  return result;
}

/**
 * Close Position Ratio = (close - low) / (high - low) * 100.
 * If high == low, return 50.
 * Result length = closes.length. Offset = 0.
 */
export function computeClosePositionRatio(
  highs: number[],
  lows: number[],
  closes: number[],
): number[] {
  return closes.map((c, i) => {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    if (h === l) return 50;
    return ((c - l) / (h - l)) * 100;
  });
}

/**
 * Candle pattern detection. Returns one pattern name per bar (null if none).
 * Result length = closes.length. Offset = 0.
 */
export function detectCandlePatterns(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
): Array<string | null> {
  const n = closes.length;
  const result: Array<string | null> = [];

  for (let i = 0; i < n; i++) {
    const open = opens[i] ?? 0;
    const high = highs[i] ?? 0;
    const low = lows[i] ?? 0;
    const close = closes[i] ?? 0;

    const body = Math.abs(close - open);
    const totalRange = high - low;
    const upperShadow = high - Math.max(close, open);
    const lowerShadow = Math.min(close, open) - low;

    let pattern: string | null = null;

    // 1. morning_star (3-bar)
    if (i >= 2 && pattern === null) {
      const o2 = opens[i - 2] ?? 0;
      const c2 = closes[i - 2] ?? 0;
      const r2 = (highs[i - 2] ?? 0) - (lows[i - 2] ?? 0);
      const o1 = opens[i - 1] ?? 0;
      const c1 = closes[i - 1] ?? 0;
      const h1 = highs[i - 1] ?? 0;
      const l1 = lows[i - 1] ?? 0;
      const r1 = h1 - l1;
      const body1 = Math.abs(c1 - o1);
      const body2 = Math.abs(c2 - o2);
      const bearish2 = c2 < o2;
      const bullishCur = close > open;
      const midpoint2 = (o2 + c2) / 2;
      if (
        bearish2 &&
        r2 > 0 &&
        body2 > 0.5 * r2 &&
        r1 > 0 &&
        body1 < 0.2 * r1 &&
        bullishCur &&
        close > midpoint2
      ) {
        pattern = 'morning_star';
      }
    }

    // 2. evening_star (3-bar)
    if (i >= 2 && pattern === null) {
      const o2 = opens[i - 2] ?? 0;
      const c2 = closes[i - 2] ?? 0;
      const r2 = (highs[i - 2] ?? 0) - (lows[i - 2] ?? 0);
      const o1 = opens[i - 1] ?? 0;
      const c1 = closes[i - 1] ?? 0;
      const h1 = highs[i - 1] ?? 0;
      const l1 = lows[i - 1] ?? 0;
      const r1 = h1 - l1;
      const body1 = Math.abs(c1 - o1);
      const body2 = Math.abs(c2 - o2);
      const bullish2 = c2 > o2;
      const bearishCur = close < open;
      const midpoint2 = (o2 + c2) / 2;
      if (
        bullish2 &&
        r2 > 0 &&
        body2 > 0.5 * r2 &&
        r1 > 0 &&
        body1 < 0.2 * r1 &&
        bearishCur &&
        close < midpoint2
      ) {
        pattern = 'evening_star';
      }
    }

    // 3. bullish_engulf (2-bar)
    if (i >= 1 && pattern === null) {
      const po = opens[i - 1] ?? 0;
      const pc = closes[i - 1] ?? 0;
      const prevBearish = pc < po;
      const curBullish = close > open;
      if (prevBearish && curBullish && open <= pc && close >= po) {
        pattern = 'bullish_engulf';
      }
    }

    // 4. bearish_engulf (2-bar)
    if (i >= 1 && pattern === null) {
      const po = opens[i - 1] ?? 0;
      const pc = closes[i - 1] ?? 0;
      const prevBullish = pc > po;
      const curBearish = close < open;
      if (prevBullish && curBearish && open >= pc && close <= po) {
        pattern = 'bearish_engulf';
      }
    }

    // 5. dark_cloud_cover (2-bar)
    if (i >= 1 && pattern === null) {
      const po = opens[i - 1] ?? 0;
      const pc = closes[i - 1] ?? 0;
      const ph = highs[i - 1] ?? 0;
      const pr = ph - (lows[i - 1] ?? 0);
      const pbody = Math.abs(pc - po);
      const prevBullish = pc > po;
      const midpointPrev = (po + pc) / 2;
      if (
        prevBullish &&
        pr > 0 &&
        pbody > 0.5 * pr &&
        open > ph &&
        close < midpointPrev &&
        close > po
      ) {
        pattern = 'dark_cloud_cover';
      }
    }

    // 6. piercing_line (2-bar)
    if (i >= 1 && pattern === null) {
      const po = opens[i - 1] ?? 0;
      const pc = closes[i - 1] ?? 0;
      const pl = lows[i - 1] ?? 0;
      const pr = (highs[i - 1] ?? 0) - pl;
      const pbody = Math.abs(pc - po);
      const prevBearish = pc < po;
      const midpointPrev = (po + pc) / 2;
      if (
        prevBearish &&
        pr > 0 &&
        pbody > 0.5 * pr &&
        open < pl &&
        close > midpointPrev &&
        close < po
      ) {
        pattern = 'piercing_line';
      }
    }

    // 7. gravestone_doji
    if (pattern === null && totalRange > 0) {
      if (
        body / totalRange < 0.05 &&
        lowerShadow < 0.1 * totalRange &&
        upperShadow > 0.7 * totalRange
      ) {
        pattern = 'gravestone_doji';
      }
    }

    // 8. dragonfly_doji
    if (pattern === null && totalRange > 0) {
      if (
        body / totalRange < 0.05 &&
        upperShadow < 0.1 * totalRange &&
        lowerShadow > 0.7 * totalRange
      ) {
        pattern = 'dragonfly_doji';
      }
    }

    // 9. long_legged_doji
    if (pattern === null && totalRange > 0) {
      if (
        body / totalRange < 0.05 &&
        upperShadow > 0.3 * totalRange &&
        lowerShadow > 0.3 * totalRange
      ) {
        pattern = 'long_legged_doji';
      }
    }

    // 10. doji
    if (pattern === null && totalRange > 0) {
      if (body / totalRange < 0.05) {
        pattern = 'doji';
      }
    }

    // 11. marubozu_bull
    if (pattern === null && totalRange > 0) {
      if (close > open && body / totalRange >= 0.9) {
        pattern = 'marubozu_bull';
      }
    }

    // 12. marubozu_bear
    if (pattern === null && totalRange > 0) {
      if (close < open && body / totalRange >= 0.9) {
        pattern = 'marubozu_bear';
      }
    }

    // 13. hammer
    if (pattern === null && totalRange > 0 && body > 0) {
      if (lowerShadow >= 2 * body && upperShadow <= 0.1 * totalRange && body / totalRange <= 0.4) {
        pattern = 'hammer';
      }
    }

    // 14. inverted_hammer (bullish)
    if (pattern === null && totalRange > 0 && body > 0) {
      if (
        upperShadow >= 2 * body &&
        lowerShadow <= 0.1 * totalRange &&
        body / totalRange <= 0.4 &&
        close >= open
      ) {
        pattern = 'inverted_hammer';
      }
    }

    // 15. shooting_star (bearish inverted hammer)
    if (pattern === null && totalRange > 0 && body > 0) {
      if (
        upperShadow >= 2 * body &&
        lowerShadow <= 0.1 * totalRange &&
        body / totalRange <= 0.4 &&
        close < open
      ) {
        pattern = 'shooting_star';
      }
    }

    // 16. spinning_top
    if (pattern === null && totalRange > 0) {
      if (
        body / totalRange < 0.35 &&
        upperShadow >= 0.2 * totalRange &&
        lowerShadow >= 0.2 * totalRange
      ) {
        pattern = 'spinning_top';
      }
    }

    result.push(pattern);
  }

  return result;
}

/**
 * MA Stack count (0-4). Aligns all three EMA arrays to ema200 length.
 */
export function computeMaStack(
  closes: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
): number[] {
  const len = ema200.length;
  if (len === 0) return [];

  const alignedCloses = closes.slice(closes.length - len);
  const alignedEma20 = ema20.slice(ema20.length - len);
  const alignedEma50 = ema50.slice(ema50.length - len);

  return alignedCloses.map((close, i) => {
    const e20 = alignedEma20[i] ?? 0;
    const e50 = alignedEma50[i] ?? 0;
    const e200 = ema200[i] ?? 0;
    let count = 0;
    if (close > e20) count++;
    if (e20 > e50) count++;
    if (e50 > e200) count++;
    if (close > e200) count++;
    return count;
  });
}

/**
 * EMA Slope = (ema[i] - ema[i-lookback]) / ema[i-lookback].
 * Result length = ema.length - lookback. Offset = lookback.
 */
export function computeEmaSlope(ema: number[], lookback = 10): number[] {
  const n = ema.length;
  if (n <= lookback) return [];

  const result: number[] = [];
  for (let i = lookback; i < n; i++) {
    const prev = ema[i - lookback] ?? 0;
    result.push(prev === 0 ? 0 : ((ema[i] ?? 0) - prev) / prev);
  }
  return result;
}

type OhlcvRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function getMondayDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - ((d.getDay() || 7) - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate daily OHLCV rows to weekly bars (Monday start).
 */
export function aggregateToWeekly(rows: OhlcvRow[]): OhlcvRow[] {
  if (rows.length === 0) return [];

  const weekMap = new Map<string, OhlcvRow>();
  const weekOrder: string[] = [];

  for (const row of rows) {
    const monday = getMondayDate(row.date);
    if (!weekMap.has(monday)) {
      weekMap.set(monday, {
        date: monday,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      });
      weekOrder.push(monday);
    } else {
      const existing = weekMap.get(monday);
      if (existing) {
        existing.high = Math.max(existing.high, row.high);
        existing.low = Math.min(existing.low, row.low);
        existing.close = row.close;
        existing.volume += row.volume;
      }
    }
  }

  return weekOrder.flatMap((k) => {
    const entry = weekMap.get(k);
    return entry ? [entry] : [];
  });
}

/**
 * Aggregate daily OHLCV rows to monthly bars (YYYY-MM grouping).
 */
export function aggregateToMonthly(rows: OhlcvRow[]): OhlcvRow[] {
  if (rows.length === 0) return [];

  const monthMap = new Map<string, OhlcvRow & { _firstDate: string }>();
  const monthOrder: string[] = [];

  for (const row of rows) {
    const month = row.date.slice(0, 7); // YYYY-MM
    if (!monthMap.has(month)) {
      monthMap.set(month, {
        date: row.date,
        _firstDate: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      });
      monthOrder.push(month);
    } else {
      const existing = monthMap.get(month);
      if (existing) {
        existing.high = Math.max(existing.high, row.high);
        existing.low = Math.min(existing.low, row.low);
        existing.close = row.close;
        existing.volume += row.volume;
      }
    }
  }

  return monthOrder.flatMap((k) => {
    const r = monthMap.get(k);
    if (!r) return [];
    return [
      { date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume },
    ];
  });
}

// ---------------------------------------------------------------------------
// Composite / scoring functions
// ---------------------------------------------------------------------------

export interface StageOpts {
  close: number;
  sma200: number;
  sma200Slope: number;
  maStack: number;
  pricePercentile52w: number;
  rsi14: number;
  macdHist: number;
  bbWidthContracting: boolean;
  return1m: number;
  rvol: number;
}

/**
 * Weinstein stage classification (1-4).
 * Check order: Stage 2 → Stage 4 → Stage 3 → Stage 1 (default).
 */
export function computeStage(opts: StageOpts): number {
  const {
    close,
    sma200,
    sma200Slope,
    maStack,
    pricePercentile52w,
    rsi14,
    bbWidthContracting,
    return1m,
    rvol,
  } = opts;

  // Stage 2: Advancing
  if (close > sma200 && sma200Slope > 0 && maStack >= 3 && pricePercentile52w > 50) return 2;

  // Stage 4: Declining
  if (close < sma200 && sma200Slope < 0 && maStack <= 1) return 4;

  // Stage 3: Topping
  if (close > sma200 && maStack <= 2 && rsi14 < 60 && (return1m < 0 || bbWidthContracting))
    return 3;

  // Stage 1: Basing (default)
  if (
    Math.abs((close - sma200) / sma200) <= 0.05 &&
    pricePercentile52w >= 20 &&
    pricePercentile52w <= 60 &&
    (rvol < 0.9 || rsi14 < 55)
  )
    return 1;

  return 1;
}

export interface SniperScoreOpts {
  maStack: number;
  macdHist: number;
  macdHistPrev: number | null;
  psarSignal: number;
  stage: number;
  rsRankInSegment: number | null;
  rvol: number;
  closedAboveVwap: number;
  tfAlignmentScore: number;
}

/**
 * Sniper score: sum of 7 components → verdict string.
 */
export function computeSniperScore(opts: SniperScoreOpts): { score: number; verdict: string } {
  const {
    maStack,
    macdHist,
    macdHistPrev,
    psarSignal,
    stage,
    rsRankInSegment,
    rvol,
    closedAboveVwap,
    tfAlignmentScore,
  } = opts;

  // Trend_EMA
  let trendEma = 0;
  if (maStack === 4) trendEma = 3;
  else if (maStack === 3) trendEma = 1;
  else if (maStack === 2) trendEma = -1;
  else trendEma = -3;

  // MACD
  let macdScore = 0;
  const histPrev = macdHistPrev ?? 0;
  if (macdHist > 0 && macdHist > histPrev) macdScore = 2;
  else if (macdHist > 0) macdScore = 1;
  else if (macdHist < 0 && macdHist < histPrev) macdScore = -2;
  else if (macdHist < 0) macdScore = -1;

  // PSAR
  const psarScore = psarSignal === 1 ? 0.5 : psarSignal === -1 ? -0.5 : 0;

  // Stage
  let stageScore = 0;
  if (stage === 2) stageScore = 3;
  else if (stage === 1) stageScore = 0.75;
  else if (stage === 3) stageScore = -0.75;
  else if (stage === 4) stageScore = -2.25;

  // RS_Rank
  let rsScore = 0;
  if (rsRankInSegment !== null) {
    if (rsRankInSegment >= 75) rsScore = 1.5;
    else if (rsRankInSegment >= 50) rsScore = 0.75;
    else if (rsRankInSegment < 30) rsScore = -0.75;
  }

  // Volume
  let volScore = 0;
  if (rvol >= 1.5 && closedAboveVwap === 1) volScore = 1.0;
  else if (rvol >= 1.0) volScore = 0.5;
  else if (rvol < 0.7) volScore = -0.5;

  // TF_Align
  const tfScore = tfAlignmentScore * 1.0;

  const score = trendEma + macdScore + psarScore + stageScore + rsScore + volScore + tfScore;

  let verdict: string;
  if (score >= 8) verdict = 'Strong Buy';
  else if (score >= 4) verdict = 'Buy';
  else if (score >= 0) verdict = 'Watch';
  else if (score >= -3) verdict = 'Avoid';
  else verdict = 'Sell';

  return { score, verdict };
}

/**
 * Composite score: maps sniper score to 0-100 scale with letter grade.
 */
export function computeCompositeScore(sniperScore: number): { score: number; grade: string } {
  const score = Math.round(Math.max(0, Math.min(100, ((sniperScore + 10) / 30) * 100)));
  let grade: string;
  if (score >= 80) grade = 'A';
  else if (score >= 65) grade = 'B';
  else if (score >= 50) grade = 'C';
  else grade = 'D';
  return { score, grade };
}

export interface TfAlignmentOpts {
  maStack: number;
  rsi14: number;
  macdHist: number;
  closeVsEma20w: number;
  closeVsEma50w: number;
  rsi14Weekly: number;
  closeVsEma10m: number;
  return3m: number;
}

/**
 * Time-frame alignment score (0-3).
 */
export function computeTfAlignmentScore(opts: TfAlignmentOpts): number {
  const {
    maStack,
    rsi14,
    macdHist,
    closeVsEma20w,
    closeVsEma50w,
    rsi14Weekly,
    closeVsEma10m,
    return3m,
  } = opts;

  const dailyBullish = maStack >= 3 && rsi14 > 50 && macdHist > 0 ? 1 : 0;
  const weeklyBullish = closeVsEma20w === 1 && closeVsEma50w === 1 && rsi14Weekly > 50 ? 1 : 0;
  const monthlyBullish = closeVsEma10m === 1 && return3m > 0 ? 1 : 0;

  return dailyBullish + weeklyBullish + monthlyBullish;
}

export interface SetupTypeOpts {
  bbWidthBottom20pct: boolean;
  dist52wkHighPct: number;
  tfAlignmentScore: number;
  stage: number;
  rvol: number;
  closedAboveVwap: number;
  pctFromEma20: number;
  rsi14: number;
  pctFromEma50: number;
  closeVsEma50w: number;
  pctFromEma200: number;
  closeVsEma20w: number;
  maStack: number;
  return1m: number;
  candlePattern: string | null;
  pctFromEma50Pos: number;
  rsi14Level: number;
}

/**
 * Setup type classification with quality score.
 */
export function computeSetupType(opts: SetupTypeOpts): {
  setupType: string | null;
  setupQuality: number;
} {
  const {
    bbWidthBottom20pct,
    dist52wkHighPct,
    tfAlignmentScore,
    stage,
    rvol,
    closedAboveVwap,
    pctFromEma20,
    rsi14,
    pctFromEma50,
    closeVsEma50w,
    pctFromEma200,
    closeVsEma20w,
    maStack,
    return1m,
    candlePattern,
  } = opts;

  // 1. breakout_confirmed
  if (dist52wkHighPct <= 0.5 && rvol >= 1.5 && closedAboveVwap === 1 && stage === 2) {
    return { setupType: 'breakout_confirmed', setupQuality: 90 };
  }

  // 2. base_breakout
  if (bbWidthBottom20pct && dist52wkHighPct <= 5 && tfAlignmentScore >= 2 && stage === 2) {
    return { setupType: 'base_breakout', setupQuality: 80 };
  }

  // 3. momentum_continuation
  if (maStack === 4 && rsi14 >= 55 && rsi14 <= 75 && rvol >= 1.2 && return1m > 5 && stage === 2) {
    return { setupType: 'momentum_continuation', setupQuality: 75 };
  }

  // 4. pullback_to_ema20
  if (
    pctFromEma20 >= -3 &&
    pctFromEma20 <= 0 &&
    tfAlignmentScore >= 2 &&
    rsi14 >= 45 &&
    rsi14 <= 60 &&
    rvol < 1.0 &&
    stage === 2
  ) {
    return { setupType: 'pullback_to_ema20', setupQuality: 70 };
  }

  // 5. pullback_to_ema50
  if (
    pctFromEma50 >= -3 &&
    pctFromEma50 <= 0 &&
    closeVsEma50w === 1 &&
    rsi14 >= 40 &&
    rsi14 <= 60 &&
    (stage === 1 || stage === 2)
  ) {
    return { setupType: 'pullback_to_ema50', setupQuality: 65 };
  }

  // 6. ema200_retest
  if (
    pctFromEma200 >= -2 &&
    pctFromEma200 <= 2 &&
    closeVsEma20w === 1 &&
    (stage === 1 || stage === 2)
  ) {
    return { setupType: 'ema200_retest', setupQuality: 60 };
  }

  // 7. extended_overdue
  if (dist52wkHighPct <= 2 && rsi14 > 75 && pctFromEma50 > 10 && stage === 2) {
    return { setupType: 'extended_overdue', setupQuality: 30 };
  }

  // 8. oversold_bounce_candidate
  const bouncePatterns = ['hammer', 'bullish_engulf', 'morning_star', 'dragonfly_doji'];
  if (
    rsi14 < 35 &&
    candlePattern !== null &&
    bouncePatterns.includes(candlePattern) &&
    (stage === 1 || stage === 2)
  ) {
    return { setupType: 'oversold_bounce_candidate', setupQuality: 50 };
  }

  // 9. structural_downtrend
  if (stage === 4) {
    return { setupType: 'structural_downtrend', setupQuality: 0 };
  }

  // 10. recovering_downtrend
  if (maStack >= 1 && maStack <= 2 && return1m > 5 && stage === 3) {
    return { setupType: 'recovering_downtrend', setupQuality: 25 };
  }

  // 11. stage1_basing
  if (stage === 1) {
    return { setupType: 'stage1_basing', setupQuality: 40 };
  }

  return { setupType: null, setupQuality: 0 };
}
