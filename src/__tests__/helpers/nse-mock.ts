// Test helpers for the NSE archive + Yahoo sources. No live network: everything goes
// through a stubbed globalThis.fetch.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

export function fixture(...parts: string[]): string {
  return readFileSync(join(FIXTURES, ...parts), 'utf-8');
}

export function fixtureBytes(...parts: string[]): Buffer {
  return readFileSync(join(FIXTURES, ...parts));
}

/** A minimal single-file ZIP with the entry STORED (compression 0). */
export function makeZip(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf-8');
  const fileName = Buffer.from(name, 'utf-8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(fileName.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, fileName, data]);
}

export const BHAV_HEADER = 'TckrSymb,SctySrs,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol';

/** A bhavcopy zip (UDiFF column names) from [symbol, series, close] rows. */
export function bhavZip(rows: Array<[string, string, number]>): Buffer {
  const lines = [
    BHAV_HEADER,
    ...rows.map(([s, ser, c]) => `${s},${ser},${c},${c + 1},${c - 1},${c},1000`),
  ];
  return makeZip('bhav.csv', `${lines.join('\n')}\n`);
}

export function bytesResponse(status: number, body: Buffer | string): Response {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  return {
    status,
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    json: async () => JSON.parse(buf.toString('utf-8')),
  } as Response;
}

/** Yahoo chart body with one bar per given ISO date. */
export function yahooChart(symbol: string, dates: string[], close = 100): unknown {
  const ts = dates.map((d) => Math.floor(Date.parse(`${d}T04:00:00Z`) / 1000));
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            symbol,
            currency: 'INR',
            regularMarketPrice: close,
            exchangeTimezoneName: 'Asia/Kolkata',
          },
          timestamp: ts,
          indicators: {
            quote: [
              {
                open: ts.map(() => close),
                high: ts.map(() => close + 1),
                low: ts.map(() => close - 1),
                close: ts.map(() => close),
                volume: ts.map(() => 5000),
              },
            ],
          },
        },
      ],
    },
  };
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD from an ind_close_all_DDMMYYYY.csv or BhavCopy_…_YYYYMMDD_… URL. */
export function dateFromUrl(url: string): string | null {
  const ind = /ind_close_all_(\d{2})(\d{2})(\d{4})\.csv/.exec(url);
  if (ind) return `${ind[3]}-${ind[2]}-${ind[1]}`;
  const bhav = /BhavCopy_NSE_CM_0_0_0_(\d{4})(\d{2})(\d{2})_F_0000/.exec(url);
  if (bhav) return `${bhav[1]}-${bhav[2]}-${bhav[3]}`;
  return null;
}
