import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOhlcv } from '../fetcher';

const FIXTURE_RESPONSE = {
  chart: {
    result: [
      {
        meta: {
          symbol: 'RELIANCE.NS',
          currency: 'INR',
          regularMarketPrice: 1430.5,
          longName: 'Reliance Industries Limited',
          exchangeTimezoneName: 'Asia/Calcutta',
        },
        timestamp: [1716076200, 1716162600], // 2024-05-19, 2024-05-20 in IST
        indicators: {
          quote: [
            {
              open: [1400.0, 1432.0],
              high: [1450.0, 1460.0],
              low: [1390.0, 1420.0],
              close: [1430.0, 1445.0],
              volume: [5000000, 4200000],
            },
          ],
          adjclose: [{ adjclose: [1430.0, 1445.0] }],
        },
      },
    ],
    error: null,
  },
};

describe('fetchOhlcv()', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => FIXTURE_RESPONSE,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses Yahoo Finance response into OhlcvRow[]', async () => {
    const rows = await fetchOhlcv('RELIANCE.NS', '2024-05-01', '2024-05-31');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.symbol).toBe('RELIANCE.NS');
    expect(rows[0]?.open).toBe(1400.0);
    expect(rows[0]?.close).toBe(1430.0);
  });

  it('converts timestamp to YYYY-MM-DD in IST timezone', async () => {
    const rows = await fetchOhlcv('RELIANCE.NS', '2024-05-01', '2024-05-31');
    // timestamp 1716076200 = 2024-05-19 03:30:00 UTC = 2024-05-19 09:00:00 IST
    expect(rows[0]?.date).toBe('2024-05-19');
  });

  it('filters out rows with null values', async () => {
    const responseWithNulls = {
      chart: {
        result: [
          {
            ...FIXTURE_RESPONSE.chart.result[0],
            timestamp: [1716076200, 1716162600, 1716249000],
            indicators: {
              quote: [
                {
                  open: [1400, null, 1432],
                  high: [1450, null, 1460],
                  low: [1390, null, 1420],
                  close: [1430, null, 1445],
                  volume: [5000000, null, 4200000],
                },
              ],
            },
          },
        ],
        error: null,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseWithNulls,
      }),
    );
    const rows = await fetchOhlcv('RELIANCE.NS', '2024-05-01', '2024-05-31');
    expect(rows).toHaveLength(2); // null row filtered out
  });

  it('retries on 429 and throws if retry also fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, ok: false }));
    const promise = fetchOhlcv('RELIANCE.NS', '2024-05-01', '2024-05-31');
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('rate limit');
    vi.useRealTimers();
  });

  it('throws on symbol not found (Yahoo returns error body)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          chart: {
            result: null,
            error: { code: 'Not Found', description: 'No fundamentals data found' },
          },
        }),
      }),
    );
    await expect(fetchOhlcv('INVALID.NS', '2024-05-01', '2024-05-31')).rejects.toThrow();
  });
});
