// Yahoo Finance HTTP fetching — rate limited, User-Agent required

import type { OhlcvRow } from './store';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; tools-nse-market-data/1.0)',
  Accept: 'application/json',
};

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

let lastCallTime = 0;
const MIN_INTERVAL_MS = 100;

async function throttledFetch(url: string): Promise<Response> {
  const elapsed = Date.now() - lastCallTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  lastCallTime = Date.now();
  return fetch(url, { headers: HEADERS });
}

async function fetchWithRetry(url: string): Promise<Response> {
  const res = await throttledFetch(url);
  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const retry = await throttledFetch(url);
    if (retry.status === 429) {
      throw new Error('Yahoo Finance rate limit exceeded — wait 30s and retry');
    }
    return retry;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Yahoo Finance response types
// ---------------------------------------------------------------------------

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        symbol: string;
        currency: string;
        regularMarketPrice: number;
        longName?: string;
        shortName?: string;
        exchangeTimezoneName: string;
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
        adjclose?: Array<{
          adjclose: (number | null)[];
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

interface YahooSearchResponse {
  quotes: Array<{
    symbol: string;
    shortname?: string;
    exchange?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestampToIstDate(unixSeconds: number): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istMs = unixSeconds * 1000 + istOffsetMs;
  const d = new Date(istMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchChartResponse(symbol: string, url: string): Promise<YahooChartResponse> {
  const res = await fetchWithRetry(url);

  if (res.status === 404) {
    throw new Error(`Symbol not found: ${symbol}`);
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance error: ${res.status}`);
  }

  const data = (await res.json()) as YahooChartResponse;
  const { chart } = data;

  if (chart.error !== null) {
    throw new Error(chart.error.description);
  }
  if (!chart.result || chart.result.length === 0) {
    throw new Error(`No data returned for symbol: ${symbol}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchOhlcv(
  symbol: string,
  fromDate: string,
  toDate: string,
): Promise<OhlcvRow[]> {
  const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
  const period2 = Math.floor(new Date(toDate).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}&includeAdjustedClose=true`;

  const data = await fetchChartResponse(symbol, url);
  const result = data.chart.result;

  // Guarded above, but satisfy TS
  if (!result || result.length === 0) {
    return [];
  }

  const item = result[0];
  if (!item) return [];

  const { timestamp, indicators } = item;
  if (!timestamp) return [];
  const quote = indicators.quote[0];
  if (!quote) return [];

  const adjcloseArr = indicators.adjclose?.[0]?.adjclose ?? null;

  const rows: OhlcvRow[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    const open = quote.open[i] ?? null;
    const high = quote.high[i] ?? null;
    const low = quote.low[i] ?? null;
    const close = quote.close[i] ?? null;
    const volume = quote.volume[i] ?? null;

    // Filter rows with any null value
    if (open === null || high === null || low === null || close === null || volume === null) {
      continue;
    }

    const ts = timestamp[i];
    if (ts === undefined) continue;

    const adjClose = adjcloseArr !== null ? (adjcloseArr[i] ?? null) : null;

    rows.push({
      symbol,
      date: timestampToIstDate(ts),
      open,
      high,
      low,
      close,
      volume,
      adjClose,
    });
  }

  return rows;
}

export async function fetchQuote(
  symbol: string,
): Promise<{ symbol: string; price: number; currency: string; name: string }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

  const data = await fetchChartResponse(symbol, url);
  const result = data.chart.result;
  if (!result || result.length === 0) {
    throw new Error(`No data returned for symbol: ${symbol}`);
  }

  const item = result[0];
  if (!item) throw new Error(`No data returned for symbol: ${symbol}`);

  const { meta } = item;
  return {
    symbol: meta.symbol,
    price: meta.regularMarketPrice,
    currency: meta.currency,
    name: meta.longName ?? meta.shortName ?? symbol,
  };
}

export async function searchSymbol(
  query: string,
): Promise<Array<{ symbol: string; shortName: string; exchange: string }>> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;

  const res = await fetchWithRetry(url);
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance error: ${res.status}`);
  }

  const data = (await res.json()) as YahooSearchResponse;
  return (data.quotes ?? []).map((q) => ({
    symbol: q.symbol,
    shortName: q.shortname ?? '',
    exchange: q.exchange ?? '',
  }));
}
