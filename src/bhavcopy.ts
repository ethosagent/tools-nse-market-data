// NSE Bhavcopy — bulk daily data download from NSE archives.
// One zip file per trading day covers ALL NSE equity symbols.
// Primary URL (new format, post-2022):
//   https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip
// Fallback URL (old format):
//   https://nsearchives.nseindia.com/content/historical/EQUITIES/{YYYY}/{MMM}/cm{DDMMMYYYY}bhav.csv.zip

import { gunzipSync } from 'node:zlib';
import type { OhlcvRow } from './store';

export interface BhavcopyCsvRow {
  symbol: string; // NSE symbol with .NS suffix (e.g. RELIANCE.NS)
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  volume: number;
  date: string; // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function newFormatUrl(date: string): string {
  const compact = date.replace(/-/g, ''); // 20240115
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${compact}_F_0000.csv.zip`;
}

function oldFormatUrl(date: string): string {
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const [y, m, d] = date.split('-');
  const mon = months[parseInt(m ?? '1', 10) - 1] ?? 'JAN';
  const day = (d ?? '01').padStart(2, '0');
  return `https://nsearchives.nseindia.com/content/historical/EQUITIES/${y}/${mon}/cm${day}${mon}${y}bhav.csv.zip`;
}

const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.nseindia.com/',
};

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function parseNewFormat(csv: string, date: string): BhavcopyCsvRow[] {
  const lines = csv.trim().split('\n');
  const header = lines[0]?.split(',').map((h) => h.trim()) ?? [];
  const idx = {
    symbol: header.indexOf('TckrSymb'),
    series: header.indexOf('SctySrs'),
    open: header.indexOf('OpnPric'),
    high: header.indexOf('HghPric'),
    low: header.indexOf('LwPric'),
    close: header.indexOf('ClsPric'),
    prev: header.indexOf('PrvsClsgPric'),
    vol: header.indexOf('TtlTradgVol'),
    date: header.indexOf('TradDt'),
  };

  const rows: BhavcopyCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]?.split(',') ?? [];
    if (cols.length < 5) continue;
    const series = cols[idx.series]?.trim();
    if (series !== 'EQ') continue; // only regular equity
    const symbol = cols[idx.symbol]?.trim();
    if (!symbol) continue;
    const tradDate = cols[idx.date]?.trim().slice(0, 10) ?? date;
    rows.push({
      symbol: `${symbol}.NS`,
      open: parseFloat(cols[idx.open] ?? '0') || 0,
      high: parseFloat(cols[idx.high] ?? '0') || 0,
      low: parseFloat(cols[idx.low] ?? '0') || 0,
      close: parseFloat(cols[idx.close] ?? '0') || 0,
      prevClose: parseFloat(cols[idx.prev] ?? '0') || 0,
      volume: parseInt(cols[idx.vol] ?? '0', 10) || 0,
      date: tradDate,
    });
  }
  return rows;
}

function parseOldFormat(csv: string, date: string): BhavcopyCsvRow[] {
  // SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN
  const lines = csv.trim().split('\n');
  const rows: BhavcopyCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]?.split(',') ?? [];
    if (cols.length < 9) continue;
    const series = cols[1]?.trim();
    if (series !== 'EQ') continue;
    const symbol = cols[0]?.trim();
    if (!symbol) continue;
    rows.push({
      symbol: `${symbol}.NS`,
      open: parseFloat(cols[2] ?? '0') || 0,
      high: parseFloat(cols[3] ?? '0') || 0,
      low: parseFloat(cols[4] ?? '0') || 0,
      close: parseFloat(cols[5] ?? '0') || 0,
      prevClose: parseFloat(cols[7] ?? '0') || 0,
      volume: parseInt(cols[8] ?? '0', 10) || 0,
      date,
    });
  }
  return rows;
}

async function downloadAndParse(
  url: string,
  date: string,
  isNew: boolean,
): Promise<BhavcopyCsvRow[]> {
  const res = await fetch(url, { headers: NSE_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const zipData = Buffer.from(buf);
  const csv = extractCsvFromZip(zipData);
  return isNew ? parseNewFormat(csv, date) : parseOldFormat(csv, date);
}

// Minimal ZIP reader — extracts the first file's deflate-compressed content.
function extractCsvFromZip(buf: Buffer): string {
  // ZIP local file header magic: PK\x03\x04
  const sig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (sig < 0) throw new Error('Not a valid ZIP file');
  const compression = buf.readUInt16LE(sig + 8);
  const compressedSize = buf.readUInt32LE(sig + 18);
  const fileNameLen = buf.readUInt16LE(sig + 26);
  const extraLen = buf.readUInt16LE(sig + 28);
  const dataStart = sig + 30 + fileNameLen + extraLen;
  const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

  if (compression === 0) {
    // Stored (no compression)
    return compressedData.toString('utf-8');
  }
  if (compression === 8) {
    // Deflate — gunzipSync with raw deflate wrapped in a gzip header
    return gunzipSync(
      Buffer.concat([
        Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]),
        compressedData,
      ]),
    ).toString('utf-8');
  }
  throw new Error(`Unsupported ZIP compression method: ${compression}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download and parse one trading day's Bhavcopy.
 * Tries new format first, falls back to old format.
 * Returns empty array (not an error) if the date is a holiday / non-trading day.
 */
export async function fetchBhavcopy(date: string): Promise<BhavcopyCsvRow[]> {
  // Try new format
  try {
    return await downloadAndParse(newFormatUrl(date), date, true);
  } catch {
    // Try old format
    try {
      return await downloadAndParse(oldFormatUrl(date), date, false);
    } catch {
      return []; // holiday / unavailable — not an error
    }
  }
}

/**
 * Download Bhavcopy files for every trading day in [fromDate, toDate].
 * Returns a map of symbol → OhlcvRow[] for only the requested symbols.
 * If symbols is undefined, returns all symbols.
 *
 * This is the efficient bulk path: one HTTP request per day gets all symbols.
 */
export async function fetchBhavcopayRange(
  fromDate: string,
  toDate: string,
  symbols?: Set<string>,
  onProgress?: (done: number, total: number, date: string) => void,
  concurrency = 5,
): Promise<Map<string, OhlcvRow[]>> {
  const dates = tradingDaysBetween(fromDate, toDate);
  const result = new Map<string, OhlcvRow[]>();
  let done = 0;

  for (let i = 0; i < dates.length; i += concurrency) {
    const batch = dates.slice(i, i + concurrency);
    const batchRows = await Promise.all(batch.map((date) => fetchBhavcopy(date)));

    for (let j = 0; j < batch.length; j++) {
      const date = batch[j] as string;
      const rows = batchRows[j] as BhavcopyCsvRow[];
      for (const row of rows) {
        if (symbols && !symbols.has(row.symbol)) continue;
        const ohlcv: OhlcvRow = {
          symbol: row.symbol,
          date: row.date,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          adjClose: null,
        };
        const existing = result.get(row.symbol) ?? [];
        existing.push(ohlcv);
        result.set(row.symbol, existing);
      }
      done++;
      onProgress?.(done, dates.length, date);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate all calendar dates between from and to (inclusive) that are Mon–Fri. */
function tradingDaysBetween(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) {
      // exclude Sunday (0) and Saturday (6)
      dates.push(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
