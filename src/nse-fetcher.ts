// NSE India public API fetcher — cookie-based session management
// Two-step init: 1) GET homepage for cookies, 2) use cookies on subsequent calls
// Rate limit: 500ms minimum between calls (module-level)

const NSE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
  'X-Requested-With': 'XMLHttpRequest',
};

// Module-level state (not exported)
let cookieCache: { value: string; expiresAt: number } | null = null;
let lastCallAt = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = 500 - (now - lastCallAt);
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function ensureCookies(): Promise<string> {
  const now = Date.now();
  if (cookieCache && now < cookieCache.expiresAt) return cookieCache.value;
  const res = await fetch('https://www.nseindia.com/', {
    headers: NSE_HEADERS,
  });
  if (!res.ok) throw new Error(`NSE cookie fetch failed: HTTP ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookie.map((c: string) => c.split(';')[0]).join('; ');
  cookieCache = { value: cookieStr, expiresAt: now + 5 * 60 * 1000 };
  return cookieStr;
}

async function nseGet(url: string): Promise<unknown> {
  await rateLimit();
  const cookie = await ensureCookies();
  const res = await fetch(url, {
    headers: { ...NSE_HEADERS, Cookie: cookie },
  });
  if (!res.ok) {
    throw new Error(`NSE API error: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Format a YYYY-MM-DD date as DD-Mon-YYYY for NSE historical API */
function toNseDate(date: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [y, m, d] = date.split('-');
  const mon = months[parseInt(m ?? '1', 10) - 1] ?? 'Jan';
  return `${(d ?? '01').padStart(2, '0')}-${mon}-${y}`;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface FiiDiiRow {
  date: string; // YYYY-MM-DD
  fii_buy: number;
  fii_sell: number;
  fii_net: number;
  dii_buy: number;
  dii_sell: number;
  dii_net: number;
}

export interface CorporateActionRow {
  symbol: string;
  ex_date: string;
  purpose: string;
  value: string | null;
}

export interface BulkBlockDealRow {
  date: string;
  symbol: string;
  client_name: string;
  deal_type: 'bulk' | 'block';
  trade_type: string;
  quantity: number;
  price: number;
}

// ---------------------------------------------------------------------------
// Fetch FII/DII
// ---------------------------------------------------------------------------

export async function fetchFiiDii(date?: string): Promise<FiiDiiRow[]> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const data = (await nseGet('https://www.nseindia.com/api/fiidiiTradeReact')) as Array<{
    category: string;
    buyValue: string | number;
    sellValue: string | number;
    netValue?: string | number;
    date?: string;
  }>;

  if (!Array.isArray(data)) return [];

  let fii_buy = 0;
  let fii_sell = 0;
  let dii_buy = 0;
  let dii_sell = 0;

  for (const entry of data) {
    const cat = (entry.category ?? '').toString().trim().toUpperCase();
    const buy = parseFloat(String(entry.buyValue ?? '0').replace(/,/g, '')) || 0;
    const sell = parseFloat(String(entry.sellValue ?? '0').replace(/,/g, '')) || 0;
    if (cat.includes('FII') || cat.includes('FPI')) {
      fii_buy += buy;
      fii_sell += sell;
    } else if (cat.includes('DII')) {
      dii_buy += buy;
      dii_sell += sell;
    }
  }

  const row: FiiDiiRow = {
    date: targetDate,
    fii_buy,
    fii_sell,
    fii_net: fii_buy - fii_sell,
    dii_buy,
    dii_sell,
    dii_net: dii_buy - dii_sell,
  };

  return [row];
}

// ---------------------------------------------------------------------------
// Fetch Corporate Actions
// ---------------------------------------------------------------------------

export async function fetchCorporateActions(
  symbol: string,
  fromDate: string,
  toDate: string,
): Promise<CorporateActionRow[]> {
  // Strip exchange suffix for the API (RELIANCE.NS → RELIANCE)
  const nseSymbol = symbol.replace(/\.(NS|BO)$/, '');
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(nseSymbol)}`;
  const data = (await nseGet(url)) as Array<{
    symbol?: string;
    exDate?: string;
    purpose?: string;
    value?: string | null;
  }>;

  if (!Array.isArray(data)) return [];

  const results: CorporateActionRow[] = [];
  for (const entry of data) {
    const exDate = normalizeDate(entry.exDate ?? '');
    if (!exDate) continue;
    if (exDate < fromDate || exDate > toDate) continue;
    results.push({
      symbol,
      ex_date: exDate,
      purpose: (entry.purpose ?? '').toString().trim(),
      value: entry.value != null ? String(entry.value).trim() : null,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Fetch Bulk / Block Deals
// ---------------------------------------------------------------------------

export async function fetchBulkBlockDeals(date: string): Promise<BulkBlockDealRow[]> {
  const nseDate = toNseDate(date);
  // block-deal: live endpoint (no date param needed)
  // bulk-deal: historical endpoint requires from/to in DD-Mon-YYYY format
  const blockData = await nseGet('https://www.nseindia.com/api/block-deal');
  let bulkData: unknown = [];
  try {
    bulkData = await nseGet(
      `https://www.nseindia.com/api/historical/bulk-deals?from=${nseDate}&to=${nseDate}`,
    );
  } catch {
    // bulk deals endpoint may be unavailable — continue with block deals only
  }

  const results: BulkBlockDealRow[] = [];

  function parseDeals(raw: unknown, dealType: 'bulk' | 'block'): void {
    const arr = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { data?: unknown })?.data)
        ? (raw as { data: unknown[] }).data
        : [];
    for (const entry of arr as Array<Record<string, unknown>>) {
      const dealDate = normalizeDate(String(entry.date ?? entry.BD_DT_DATE ?? ''));
      if (!dealDate || dealDate !== date) continue;
      const rawSymbol = String(entry.symbol ?? entry.BD_SYMBOL ?? '');
      const symbol = rawSymbol.includes('.') ? rawSymbol : `${rawSymbol}.NS`;
      const clientName = String(
        entry.clientName ?? entry.BD_CLIENT_NAME ?? entry.client_name ?? '',
      ).trim();
      const tradeType = String(entry.buySell ?? entry.BD_BUY_SELL ?? entry.trade_type ?? '').trim();
      const quantity =
        parseInt(
          String(entry.tradedQuantity ?? entry.BD_QTY_TRD ?? entry.quantity ?? '0').replace(
            /,/g,
            '',
          ),
          10,
        ) || 0;
      const price =
        parseFloat(
          String(entry.tradePrice ?? entry.BD_TP_WATP ?? entry.price ?? '0').replace(/,/g, ''),
        ) || 0;

      results.push({
        date,
        symbol,
        client_name: clientName,
        deal_type: dealType,
        trade_type: tradeType,
        quantity,
        price,
      });
    }
  }

  parseDeals(blockData, 'block');
  parseDeals(bulkData, 'bulk');

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize various date formats to YYYY-MM-DD */
function normalizeDate(raw: string): string {
  if (!raw) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // DD-Mon-YYYY (e.g. 15-Mar-2025)
  const ddMonYyyy = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw);
  if (ddMonYyyy) {
    const months: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    const m = months[ddMonYyyy[2]?.toLowerCase() ?? ''];
    if (m) return `${ddMonYyyy[3]}-${m}-${ddMonYyyy[1]?.padStart(2, '0')}`;
  }
  // Try Date parse as fallback
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {
    // ignore
  }
  return '';
}
