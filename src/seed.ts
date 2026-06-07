import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeedManifest {
  generatedAt: string;
  symbols: number;
  rows: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GITHUB_MANIFEST_URL =
  'https://github.com/MiteshSharma/tools-nse-market-data/releases/latest/download/seed-manifest.json';

export const GITHUB_SEED_URL =
  'https://github.com/MiteshSharma/tools-nse-market-data/releases/latest/download/seed.db.gz';

// ---------------------------------------------------------------------------
// readLocalManifest
// ---------------------------------------------------------------------------

/**
 * Read the locally-saved manifest. Returns the `generatedAt` string, or ''
 * if the file is missing or unreadable.
 */
export function readLocalManifest(manifestPath: string): string {
  if (!existsSync(manifestPath)) return '';
  try {
    const local = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      generatedAt?: string;
    };
    return local.generatedAt ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// fetchRemoteManifest
// ---------------------------------------------------------------------------

/**
 * Fetch the remote manifest from GitHub. Throws on network error or non-200.
 */
export async function fetchRemoteManifest(
  url: string = GITHUB_MANIFEST_URL,
): Promise<SeedManifest> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'tools-nse-market-data/seed-update' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SeedManifest;
}

// ---------------------------------------------------------------------------
// downloadSeed
// ---------------------------------------------------------------------------

/**
 * Download seed.db.gz from `url`, decompress, write to `destPath`.
 * Cleans up `destPath` on failure.
 */
export async function downloadSeed(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'tools-nse-market-data/seed-update' },
    signal: AbortSignal.timeout(600_000), // 10 min
    redirect: 'follow',
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  try {
    const { createWriteStream } = await import('node:fs');
    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    const { createGunzip } = await import('node:zlib');
    const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    await pipeline(nodeStream, createGunzip(), createWriteStream(destPath));
  } catch (err) {
    if (existsSync(destPath)) unlinkSync(destPath);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// mergeNewSymbols
// ---------------------------------------------------------------------------

/**
 * Open `tempDbPath` (read-only) and `localDbPath`, import only symbols not
 * already in local sync_meta. Returns count of new symbols imported.
 * Closes both DBs and deletes `tempDbPath` when done (success or failure).
 */
export async function mergeNewSymbols(tempDbPath: string, localDbPath: string): Promise<number> {
  const Database = (await import('better-sqlite3')).default;
  const tempDb = new Database(tempDbPath, { readonly: true });
  const localDb = new Database(localDbPath);

  try {
    // Get symbols in remote seed that are NOT in local sync_meta
    const remoteSymbols = (
      tempDb.prepare('SELECT DISTINCT symbol FROM ohlcv_daily').all() as { symbol: string }[]
    ).map((r) => r.symbol);

    const localSynced = new Set(
      (localDb.prepare('SELECT symbol FROM sync_meta').all() as { symbol: string }[]).map(
        (r) => r.symbol,
      ),
    );

    const newSymbols = remoteSymbols.filter((s) => !localSynced.has(s));

    if (newSymbols.length === 0) {
      return 0;
    }

    // Copy ohlcv_daily rows for new symbols only
    const insertStmt = localDb.prepare(
      `INSERT OR IGNORE INTO ohlcv_daily
       (symbol, date, open, high, low, close, volume, adj_close, adj_factor, delivery_qty, delivery_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const copyBatch = localDb.transaction(() => {
      for (const symbol of newSymbols) {
        const rows = tempDb
          .prepare('SELECT * FROM ohlcv_daily WHERE symbol = ?')
          .all(symbol) as Record<string, unknown>[];
        for (const row of rows) {
          insertStmt.run(
            row.symbol,
            row.date,
            row.open,
            row.high,
            row.low,
            row.close,
            row.volume,
            row.adj_close,
            row.adj_factor,
            row.delivery_qty,
            row.delivery_pct,
          );
        }
        // Copy sync_meta entry
        const meta = tempDb.prepare('SELECT * FROM sync_meta WHERE symbol = ?').get(symbol) as
          | { last_sync: number; last_date: string }
          | undefined;
        if (meta) {
          localDb
            .prepare(
              'INSERT OR IGNORE INTO sync_meta (symbol, last_sync, last_date) VALUES (?, ?, ?)',
            )
            .run(symbol, meta.last_sync, meta.last_date);
        }
        // Copy instruments row if missing
        const inst = tempDb.prepare('SELECT * FROM instruments WHERE symbol = ?').get(symbol) as
          | Record<string, unknown>
          | undefined;
        if (inst) {
          localDb
            .prepare(
              `INSERT OR IGNORE INTO instruments
               (symbol, name, exchange, sector, industry, isin, market_cap_band, instrument_type, index_category, is_active, as_of_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              inst.symbol,
              inst.name,
              inst.exchange,
              inst.sector,
              inst.industry,
              inst.isin,
              inst.market_cap_band,
              inst.instrument_type,
              inst.index_category,
              inst.is_active,
              inst.as_of_date,
            );
        }
      }
    });
    copyBatch();

    return newSymbols.length;
  } finally {
    tempDb.close();
    localDb.close();
    if (existsSync(tempDbPath)) unlinkSync(tempDbPath);
  }
}

// ---------------------------------------------------------------------------
// writeLocalManifest
// ---------------------------------------------------------------------------

/**
 * Write `manifest` to `manifestPath` as formatted JSON.
 */
export function writeLocalManifest(manifestPath: string, manifest: SeedManifest): void {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
