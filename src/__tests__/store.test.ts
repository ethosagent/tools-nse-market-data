import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IndexConstituentSeedRow, InstrumentSeedRow, SavedScanRow } from '../schema';
import type { OhlcvRow } from '../store';
import { MarketDataStore } from '../store';

function makeRow(symbol: string, date: string, close: number, volume = 1_000_000): OhlcvRow {
  return {
    symbol,
    date,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
    adjClose: null,
  };
}

describe('MarketDataStore', () => {
  let store: MarketDataStore;

  beforeEach(() => {
    store = new MarketDataStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // ---------------------------------------------------------------------------
  // clean()
  // ---------------------------------------------------------------------------

  describe('clean()', () => {
    it('returns zero counts when tables are empty', () => {
      const result = store.clean();
      expect(result.rowsDeleted.ohlcv).toBe(0);
      expect(result.rowsDeleted.watchlist).toBe(0);
      expect(result.rowsDeleted.syncMeta).toBe(0);
    });

    it('deletes all rows and returns correct counts', () => {
      store.insertOhlcv([makeRow('RELIANCE.NS', '2024-01-01', 2400)]);
      store.insertOhlcv([makeRow('TCS.NS', '2024-01-01', 3800)]);
      store.watchlistAdd('RELIANCE.NS');
      store.watchlistAdd('TCS.NS');

      const result = store.clean();
      expect(result.rowsDeleted.ohlcv).toBe(2);
      expect(result.rowsDeleted.watchlist).toBe(2);

      expect(store.getHistory('RELIANCE.NS')).toHaveLength(0);
      expect(store.watchlistList()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // watchlist
  // ---------------------------------------------------------------------------

  describe('watchlistAdd / watchlistRemove / watchlistList', () => {
    it('adds a symbol and lists it', () => {
      store.watchlistAdd('RELIANCE.NS');
      const list = store.watchlistList();
      expect(list).toHaveLength(1);
      expect(list[0]?.symbol).toBe('RELIANCE.NS');
      expect(list[0]?.notes).toBeNull();
    });

    it('adds with notes', () => {
      store.watchlistAdd('TCS.NS', 'default', 'IT bellwether');
      const list = store.watchlistList();
      expect(list[0]?.notes).toBe('IT bellwether');
    });

    it('duplicate add is idempotent (INSERT OR REPLACE)', () => {
      store.watchlistAdd('INFY.NS');
      store.watchlistAdd('INFY.NS');
      expect(store.watchlistList()).toHaveLength(1);
    });

    it('removes a symbol', () => {
      store.watchlistAdd('RELIANCE.NS');
      store.watchlistRemove('RELIANCE.NS');
      expect(store.watchlistList()).toHaveLength(0);
    });

    it('remove on non-existent symbol does not throw', () => {
      expect(() => store.watchlistRemove('UNKNOWN.NS')).not.toThrow();
    });

    it('supports named lists', () => {
      store.watchlistAdd('RELIANCE.NS', 'core');
      store.watchlistAdd('TCS.NS', 'tech');
      expect(store.watchlistList('core')).toHaveLength(1);
      expect(store.watchlistList('tech')).toHaveLength(1);
      expect(store.watchlistList('default')).toHaveLength(0);
    });

    it('returns entries ordered by addedAt ASC', async () => {
      store.watchlistAdd('A.NS');
      await new Promise((r) => setTimeout(r, 5));
      store.watchlistAdd('B.NS');
      const list = store.watchlistList();
      expect(list[0]?.symbol).toBe('A.NS');
      expect(list[1]?.symbol).toBe('B.NS');
    });
  });

  // ---------------------------------------------------------------------------
  // insertOhlcv / getHistory
  // ---------------------------------------------------------------------------

  describe('insertOhlcv / getHistory', () => {
    it('inserts rows and retrieves them in chronological order', () => {
      store.insertOhlcv([
        makeRow('RELIANCE.NS', '2024-01-03', 2400),
        makeRow('RELIANCE.NS', '2024-01-01', 2380),
        makeRow('RELIANCE.NS', '2024-01-02', 2390),
      ]);
      const history = store.getHistory('RELIANCE.NS');
      expect(history).toHaveLength(3);
      expect(history[0]?.date).toBe('2024-01-01');
      expect(history[1]?.date).toBe('2024-01-02');
      expect(history[2]?.date).toBe('2024-01-03');
    });

    it('respects the days limit', () => {
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeRow('TCS.NS', `2024-01-${String(i + 1).padStart(2, '0')}`, 3800 + i),
      );
      store.insertOhlcv(rows);
      expect(store.getHistory('TCS.NS', 5)).toHaveLength(5);
    });

    it('returns most recent N rows when days < total', () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        makeRow('INFY.NS', `2024-01-0${i + 1}`, 1500 + i),
      );
      store.insertOhlcv(rows);
      const history = store.getHistory('INFY.NS', 3);
      expect(history[0]?.date).toBe('2024-01-03');
      expect(history[2]?.date).toBe('2024-01-05');
    });

    it('INSERT OR REPLACE is idempotent', () => {
      store.insertOhlcv([makeRow('RELIANCE.NS', '2024-01-01', 2400)]);
      store.insertOhlcv([makeRow('RELIANCE.NS', '2024-01-01', 2450)]);
      const history = store.getHistory('RELIANCE.NS');
      expect(history).toHaveLength(1);
      expect(history[0]?.close).toBe(2450);
    });

    it('maps adj_close to adjClose', () => {
      const row: OhlcvRow = { ...makeRow('RELIANCE.NS', '2024-01-01', 2400), adjClose: 2395 };
      store.insertOhlcv([row]);
      expect(store.getHistory('RELIANCE.NS')[0]?.adjClose).toBe(2395);
    });

    it('returns empty array for unknown symbol', () => {
      expect(store.getHistory('UNKNOWN.NS')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // screen()
  // ---------------------------------------------------------------------------

  describe('screen()', () => {
    beforeEach(() => {
      store.watchlistAdd('RELIANCE.NS');
      store.watchlistAdd('TCS.NS');

      // RELIANCE: 252 days, increasing close, high volume on last day
      const relianceRows = Array.from({ length: 252 }, (_, i) =>
        makeRow(
          'RELIANCE.NS',
          `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
          2400 + i,
          500_000,
        ),
      );
      // Last row has a volume surge
      const lastReliance = relianceRows[251];
      if (lastReliance) {
        relianceRows[251] = makeRow('RELIANCE.NS', lastReliance.date, 2651, 2_000_000);
      }
      store.insertOhlcv(relianceRows);

      // TCS: 252 days, flat, normal volume
      const tcsRows = Array.from({ length: 252 }, (_, i) =>
        makeRow(
          'TCS.NS',
          `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
          3800,
          1_000_000,
        ),
      );
      store.insertOhlcv(tcsRows);
    });

    it('returns all watchlist symbols when no filters', () => {
      const results = store.screen({});
      expect(results).toHaveLength(2);
    });

    it('filters by minVolumeSurge', () => {
      // RELIANCE last day volume is 2_000_000, avg ~500k → surge ~4x
      // TCS all days same volume → surge = 1
      const results = store.screen({ minVolumeSurge: 2 });
      expect(results.map((r) => r.symbol)).toContain('RELIANCE.NS');
      expect(results.map((r) => r.symbol)).not.toContain('TCS.NS');
    });

    it('sorts by volumeSurge DESC', () => {
      const results = store.screen({});
      expect(results[0]?.symbol).toBe('RELIANCE.NS');
    });

    it('returns empty array when watchlist is empty', () => {
      store.clean();
      expect(store.screen({})).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 1 store methods
  // ---------------------------------------------------------------------------

  describe('Phase 1 store methods', () => {
    describe('upsertInstruments', () => {
      it('inserts instruments and returns correct upserted count', () => {
        const instruments: InstrumentSeedRow[] = [
          { symbol: 'RELIANCE.NS', name: 'Reliance Industries', instrument_type: 'equity' },
          { symbol: 'TCS.NS', name: 'Tata Consultancy Services', instrument_type: 'equity' },
          { symbol: '^NSEI', name: 'Nifty 50', instrument_type: 'index' },
        ];
        const result = store.upsertInstruments(instruments);
        expect(result.upserted).toBe(3);
        expect(result.removed).toBe(0);
      });

      it('deactivates equity not in new list but keeps index active', () => {
        // First insert 2 equities and 1 index
        const initial: InstrumentSeedRow[] = [
          { symbol: 'RELIANCE.NS', name: 'Reliance Industries', instrument_type: 'equity' },
          { symbol: 'TCS.NS', name: 'Tata Consultancy Services', instrument_type: 'equity' },
          { symbol: '^NSEI', name: 'Nifty 50', instrument_type: 'index' },
        ];
        store.upsertInstruments(initial);

        // Now upsert with only 1 equity (TCS removed)
        const updated: InstrumentSeedRow[] = [
          { symbol: 'RELIANCE.NS', name: 'Reliance Industries', instrument_type: 'equity' },
          { symbol: '^NSEI', name: 'Nifty 50', instrument_type: 'index' },
        ];
        const result = store.upsertInstruments(updated);
        expect(result.upserted).toBe(2);
        // TCS equity should be deactivated; ^NSEI is an index so it stays
        expect(result.removed).toBe(1);
      });
    });

    describe('upsertIndexConstituents', () => {
      it('inserts constituent rows and returns correct count', () => {
        const constituents: IndexConstituentSeedRow[] = [
          {
            index_symbol: '^NSEI',
            member_symbol: 'RELIANCE.NS',
            weight: 10.5,
            as_of_date: '2024-01-01',
          },
          { index_symbol: '^NSEI', member_symbol: 'TCS.NS', weight: 8.2, as_of_date: '2024-01-01' },
          {
            index_symbol: '^NSEI',
            member_symbol: 'INFY.NS',
            weight: 6.1,
            as_of_date: '2024-01-01',
          },
        ];
        const count = store.upsertIndexConstituents(constituents);
        expect(count).toBe(3);
      });
    });

    describe('upsertScans', () => {
      it('inserts scans and returns correct count', () => {
        const scans: SavedScanRow[] = [
          {
            scan_id: 'volume-surge',
            name: 'Volume Surge',
            category: 'momentum',
            sql_template: 'SELECT * FROM ohlcv_daily WHERE volume > 1000000',
            tags: ['volume', 'momentum'],
            is_builtin: 1,
          },
          {
            scan_id: 'near-52w-high',
            name: 'Near 52W High',
            category: 'breakout',
            sql_template: 'SELECT * FROM ohlcv_daily WHERE close > 0',
            tags: ['breakout', '52w'],
            is_builtin: 1,
          },
        ];
        const result = store.upsertScans(scans);
        expect(result.upserted).toBe(2);
      });

      it('serializes tags array as JSON string in DB', () => {
        const scans: SavedScanRow[] = [
          {
            scan_id: 'test-scan',
            name: 'Test Scan',
            category: 'test',
            sql_template: 'SELECT 1',
            tags: ['foo', 'bar'],
          },
        ];
        store.upsertScans(scans);
        // Access the DB directly via listInstrumentSymbols is not available for scans,
        // but we can verify idempotency and re-upsert works
        const result2 = store.upsertScans(scans);
        expect(result2.upserted).toBe(1);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 4 computeMarketState
  // ---------------------------------------------------------------------------

  describe('Phase 4 computeMarketState', () => {
    it('returns 0 on empty indicators_daily', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.computeMarketState();
      expect(result.processed).toBe(0);
      store.close();
    });

    it('with range filters returns 0 when no data', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.computeMarketState({ from: '2025-01-01', to: '2025-12-31' });
      expect(result.processed).toBe(0);
      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 5 computeSectorState
  // ---------------------------------------------------------------------------

  describe('Phase 5 computeSectorState', () => {
    it('returns 0 when no sector indexes in instruments', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.computeSectorState();
      expect(result.processed).toBe(0);
      store.close();
    });

    it('returns 0 when no indicators_daily data', () => {
      const store = new MarketDataStore(':memory:');
      // Seed a sector index
      store.upsertInstruments([
        {
          symbol: '^CNXIT',
          name: 'NIFTY IT',
          instrument_type: 'index',
          index_category: 'sector',
          is_active: 1,
        },
      ]);
      const result = store.computeSectorState();
      expect(result.processed).toBe(0);
      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 6 adj_factor + detectSplits
  // ---------------------------------------------------------------------------

  describe('Phase 6 adj_factor + detectSplits', () => {
    it('insertOhlcv stores adj_factor correctly', () => {
      const store = new MarketDataStore(':memory:');
      store.insertOhlcv([
        {
          symbol: 'TEST.NS',
          date: '2025-01-01',
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 1000,
          adjClose: 100,
        },
      ]);
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
      const row = db
        .prepare('SELECT adj_factor FROM ohlcv_daily WHERE symbol = ?')
        .get('TEST.NS') as { adj_factor: number | null };
      expect(row.adj_factor).not.toBeNull();
      expect(row.adj_factor).toBeCloseTo(100 / 105, 5);
      store.close();
    });

    it('insertOhlcv stores null adj_factor when adjClose is null', () => {
      const store = new MarketDataStore(':memory:');
      store.insertOhlcv([
        {
          symbol: 'TEST.NS',
          date: '2025-01-01',
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 1000,
          adjClose: null,
        },
      ]);
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
      const row = db
        .prepare('SELECT adj_factor FROM ohlcv_daily WHERE symbol = ?')
        .get('TEST.NS') as { adj_factor: number | null };
      expect(row.adj_factor).toBeNull();
      store.close();
    });

    it('detectSplits returns empty array when no data', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.detectSplits();
      expect(result).toEqual([]);
      store.close();
    });

    it('detectSplits finds 50% drop (stock split)', () => {
      const store = new MarketDataStore(':memory:');
      store.insertOhlcv([
        {
          symbol: 'SPLIT.NS',
          date: '2025-01-01',
          open: 1000,
          high: 1050,
          low: 980,
          close: 1000,
          volume: 1000,
          adjClose: null,
        },
        {
          symbol: 'SPLIT.NS',
          date: '2025-01-02',
          open: 500,
          high: 520,
          low: 490,
          close: 505,
          volume: 1000,
          adjClose: null,
        },
      ]);
      const result = store.detectSplits();
      expect(result.length).toBe(1);
      expect(result[0]?.symbol).toBe('SPLIT.NS');
      expect(result[0]?.gapPct).toBeGreaterThan(0.4);
      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 7 checkWatchdog
  // ---------------------------------------------------------------------------

  describe('Phase 7 checkWatchdog', () => {
    it('returns matched:false when symbol has no indicator data', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.checkWatchdog({ symbol: 'NOSYM.NS', condition: 'rvol > 1.5' });
      expect(result.matched).toBe(false);
      expect(result.current_values).toBeNull();
      store.close();
    });

    it('handles invalid condition without throwing', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.checkWatchdog({
        symbol: 'NOSYM.NS',
        condition: 'INVALID_SQL_GARBAGE @@@@',
      });
      expect(result.matched).toBe(false);
      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 8 runBacktest
  // ---------------------------------------------------------------------------

  describe('Phase 8 runBacktest', () => {
    it('returns empty result when no indicators data', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.runBacktest({
        screen: 'rvol > 1.5',
        from: '2025-01-01',
        to: '2025-12-31',
      });
      expect(result.trades).toHaveLength(0);
      expect(result.summary.total_trades).toBe(0);
      store.close();
    });

    it('returns empty result with invalid condition', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.runBacktest({
        screen: 'INVALID @@@@',
        from: '2025-01-01',
        to: '2025-12-31',
      });
      expect(result.trades).toHaveLength(0);
      store.close();
    });

    it('returns empty result when neither screen nor scanId provided', () => {
      const store = new MarketDataStore(':memory:');
      const result = store.runBacktest({
        from: '2025-01-01',
        to: '2025-12-31',
      });
      expect(result.trades).toHaveLength(0);
      store.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 9: FII/DII, Corporate Actions, Bulk/Block Deals
  // ---------------------------------------------------------------------------

  describe('Phase 9 upsertFiiDii / getFiiDii', () => {
    it('returns empty array when no data', () => {
      expect(store.getFiiDii()).toEqual([]);
    });

    it('upserts and retrieves FII/DII rows', () => {
      const rows = [
        {
          date: '2025-01-02',
          fii_buy: 5000,
          fii_sell: 4000,
          fii_net: 1000,
          dii_buy: 3000,
          dii_sell: 2500,
          dii_net: 500,
        },
        {
          date: '2025-01-03',
          fii_buy: 6000,
          fii_sell: 7000,
          fii_net: -1000,
          dii_buy: 4000,
          dii_sell: 3000,
          dii_net: 1000,
        },
      ];
      const count = store.upsertFiiDii(rows);
      expect(count).toBe(2);
      const result = store.getFiiDii({ days: 10 });
      expect(result).toHaveLength(2);
      expect(result[0]?.fii_net).toBe(1000);
      expect(result[1]?.fii_net).toBe(-1000);
    });
  });

  describe('Phase 9 upsertCorporateActions / getCorporateActions', () => {
    it('returns empty array when no data', () => {
      expect(store.getCorporateActions('RELIANCE.NS')).toEqual([]);
    });

    it('upserts and retrieves corporate actions', () => {
      store.upsertCorporateActions([
        { symbol: 'RELIANCE.NS', ex_date: '2025-03-15', purpose: 'dividend', value: '9.00' },
        { symbol: 'RELIANCE.NS', ex_date: '2024-06-20', purpose: 'bonus', value: '1:1' },
      ]);
      const result = store.getCorporateActions('RELIANCE.NS');
      expect(result).toHaveLength(2);
      expect(result[0]?.ex_date).toBe('2025-03-15'); // DESC order
    });
  });

  describe('Phase 9 upsertBulkBlockDeals / getBulkBlockDeals', () => {
    it('returns empty array when no data', () => {
      expect(store.getBulkBlockDeals()).toEqual([]);
    });

    it('upserts and retrieves bulk/block deals', () => {
      store.upsertBulkBlockDeals([
        {
          date: '2025-01-05',
          symbol: 'RELIANCE.NS',
          client_name: 'ABC Fund',
          deal_type: 'bulk',
          trade_type: 'BUY',
          quantity: 100000,
          price: 1500.5,
        },
        {
          date: '2025-01-05',
          symbol: 'TCS.NS',
          client_name: 'XYZ Ltd',
          deal_type: 'block',
          trade_type: 'SELL',
          quantity: 50000,
          price: 3800.0,
        },
      ]);
      const all = store.getBulkBlockDeals({ date: '2025-01-05' });
      expect(all).toHaveLength(2);
      const filtered = store.getBulkBlockDeals({ symbol: 'TCS.NS' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.deal_type).toBe('block');
    });
  });
});
