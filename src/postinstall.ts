#!/usr/bin/env node
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(__filename), '..');

async function main(): Promise<void> {
  const destPath =
    process.env.NSE_MARKET_DATA_DB ?? join(homedir(), '.ethos', 'market-data', 'market.db');
  const destDir = dirname(destPath);

  // Skip if DB already exists and has real data (>100 KB)
  if (existsSync(destPath) && statSync(destPath).size > 100_000) {
    process.stdout.write('NSE market data: existing DB found — skipping seed.\n');
    return;
  }

  const seedPath = join(packageRoot, 'data', 'seed.db.gz');
  if (!existsSync(seedPath)) {
    process.stdout.write(
      'NSE market data: no seed.db.gz bundled — run `nse-market-data backfill --all` to populate.\n',
    );
    return;
  }

  mkdirSync(destDir, { recursive: true });

  const seedSizeMb = (statSync(seedPath).size / 1_048_576).toFixed(1);
  process.stdout.write(
    `NSE market data: seeding from bundled snapshot (${seedSizeMb}MB compressed)...\n`,
  );

  await pipeline(createReadStream(seedPath), createGunzip(), createWriteStream(destPath));

  const dbSizeMb = (statSync(destPath).size / 1_048_576).toFixed(1);
  process.stdout.write(
    `NSE market data: ready at ${destPath} (${dbSizeMb}MB). Run \`nse-market-data update\` to sync latest days.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `NSE market data seed warning: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(0);
});
