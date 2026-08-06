import _pkg from 'node-sqlite3-wasm';
import { describe, expect, it } from 'vitest';
import { migrate } from '../schema';
import { createNseMarketDataTools, MARKET_QUERY_DESCRIPTION } from '../tools';

const { Database } = _pkg;

describe('createNseMarketDataTools()', () => {
  it('returns 26 tools', () => {
    const tools = createNseMarketDataTools();
    expect(tools).toHaveLength(26);
  });

  it('all tools have required fields', () => {
    const tools = createNseMarketDataTools();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      // nse_market_query is on its own toolset so a personality can hold the
      // curated scans without holding arbitrary SQL.
      expect(tool.toolset).toBe(tool.name === 'nse_market_query' ? 'market_query' : 'market');
      expect(tool.schema).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('tool names match expected list', () => {
    const tools = createNseMarketDataTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('nse_market_clean');
    expect(names).toContain('nse_market_backfill');
    expect(names).toContain('nse_market_update');
    expect(names).toContain('nse_watchlist_add');
    expect(names).toContain('nse_watchlist_remove');
    expect(names).toContain('nse_watchlist_show');
    expect(names).toContain('nse_market_history');
    expect(names).toContain('nse_market_screen');
    expect(names).toContain('nse_run_scan');
    expect(names).toContain('nse_invoke_skill');
    expect(names).toContain('nse_market_brief');
    expect(names).toContain('nse_market_indicators');
    expect(names).toContain('nse_compute_indicators');
    expect(names).toContain('nse_watchdog');
    expect(names).toContain('nse_backtest');
    expect(names).toContain('nse_get_quote');
    expect(names).toContain('nse_get_index');
    expect(names).toContain('nse_get_fii_dii');
    expect(names).toContain('nse_get_corporate_actions');
    expect(names).toContain('nse_get_bulk_block');
    expect(names).toContain('nse_get_gift_nifty');
    expect(names).toContain('nse_market_query');
    expect(names).toContain('nse_instrument_add');
  });
});

// Drift gate: the schema is inlined in the tool description, so a column added to
// schema.ts without a description update would leave the model querying blind.
describe('MARKET_QUERY_DESCRIPTION', () => {
  it('names every column of every migrated table', () => {
    const db = new Database(':memory:');
    migrate(db);
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((t) => t.name);

    const missing: string[] = [];
    for (const table of tables) {
      if (!MARKET_QUERY_DESCRIPTION.includes(table)) {
        missing.push(table);
        continue;
      }
      const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
      for (const col of cols) {
        if (!MARKET_QUERY_DESCRIPTION.includes(col.name)) {
          missing.push(`${table}.${col.name}`);
        }
      }
    }
    db.close();

    expect(missing).toEqual([]);
  });
});
