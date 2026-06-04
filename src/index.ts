// Public API — implementations filled in per tools-nse-market-data.md plan

export { computeEma, computeMacd, computeRsi, computeSma } from './indicators';
export type { BasePattern, NullPattern, PatternName, PatternResult } from './patterns';
export {
  detectChartPattern,
  detectCupWithHandle,
  detectDoubleBottom,
  detectFlatBase,
} from './patterns';
export type { OhlcvRow, ScreenerRow, SyncResult } from './store';
export { MarketDataStore } from './store';
export { NSE_NIFTY50 } from './symbols';
export {
  activate,
  createNseMarketDataTools,
  createNseMarketDataTools as createTools,
  plugin,
} from './tools';
