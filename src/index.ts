// Public API — implementations filled in per tools-nse-market-data.md plan

export { computeEma, computeMacd, computeRsi, computeSma } from './indicators';
export type { OhlcvRow, ScreenerRow, SyncResult } from './store';
export { MarketDataStore } from './store';
export { NSE_NIFTY50 } from './symbols';
export { createNseMarketDataTools, createNseMarketDataTools as createTools } from './tools';

// Ethos plugin entry point — registers all NSE tools with the agent framework.
export async function activate(api: { registerTool(tool: unknown): void }): Promise<void> {
  const { createNseMarketDataTools: create } = await import('./tools');
  for (const tool of create()) {
    api.registerTool(tool);
  }
}
