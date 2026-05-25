#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchQuote } from './fetcher';
import { fetchBulkBlockDeals, fetchCorporateActions, fetchFiiDii } from './nse-fetcher';
import type { IndexConstituentSeedRow, InstrumentSeedRow, SavedScanRow } from './schema';
import type { SyncResult } from './store';
import { MarketDataStore } from './store';
import { NSE_NIFTY50 } from './symbols';

function getPackageRoot(): string {
  // dist/cli.js is one level below package root
  const __filename = fileURLToPath(import.meta.url);
  return join(dirname(__filename), '..');
}

function readJsonFilesRecursive(dir: string): unknown[] {
  const results: unknown[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...readJsonFilesRecursive(fullPath));
      } else if (extname(entry.name) === '.json') {
        results.push(JSON.parse(readFileSync(fullPath, 'utf-8')));
      }
    }
  } catch {
    // dir doesn't exist or not readable — return empty
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDbPath(args: string[]): string {
  const dbFlag = args.indexOf('--db');
  if (dbFlag !== -1 && args[dbFlag + 1]) return args[dbFlag + 1] as string;
  const envDb = process.env.NSE_MARKET_DATA_DB;
  if (envDb) return envDb;
  return join(homedir(), '.ethos', 'market-data', 'market.db');
}

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const dbPath = resolveDbPath(rawArgs);

  // Strip --db and its value from args before dispatching
  const dbIdx = rawArgs.indexOf('--db');
  const args = dbIdx !== -1 ? [...rawArgs.slice(0, dbIdx), ...rawArgs.slice(dbIdx + 2)] : rawArgs;

  const command = args[0];

  // Help
  if (!command || command === '--help' || command === '-h') {
    console.log(`nse-market-data — NSE India market data CLI

Commands:
  clean                     Delete all local market data
  backfill [--symbols A,B] [--from YYYY-MM-DD] [--all]
                            Download 1 year of OHLCV history
  update [--mode watchlist|all]
                            Fill missing days since last sync
  watchlist add SYMBOL [--list NAME] [--notes TEXT]
  watchlist remove SYMBOL [--list NAME]
  watchlist show [--list NAME]
  history SYMBOL [--days N]
                            Show OHLCV history from local DB
  screen [--list NAME] [--volume-surge N] [--near-high N]
                            Scan watchlist against technical criteria
  quote SYMBOL              Live price from Yahoo Finance
  refresh-instruments       Load instruments and index constituents from data/ directory
  refresh-scans             Load scan definitions from scans/ directory
  compute-indicators [--symbol SYM] [--from DATE] [--to DATE] [--adjusted]
                            Compute all technical indicators
  detect-splits [--gap N]   Scan for overnight gaps > N (default 0.40 = 40%)
  compute-market-state [--from DATE] [--to DATE]
                            Compute market breadth metrics from indicators
  compute-sector-state [--from DATE] [--to DATE]
                            Compute per-sector breadth metrics from indicators
  init [--years N]          Full initialization: seed instruments + scans, backfill
                            index + watchlist symbols, compute indicators (default N=5)
  backtest --from DATE --to DATE [--screen "CONDITION"] [--scan-id ID]
           [--hold-days N] [--stop-atr-mult N] [--benchmark SYM]
                            Historical screen replay with P&L analysis
  fetch-fii-dii [--date YYYY-MM-DD] [--days N]
                            Fetch FII/DII institutional flows from NSE
  fetch-corporate-actions --symbol SYM [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                            Fetch corporate actions (dividends, splits, bonus)
  fetch-bulk-block [--date YYYY-MM-DD]
                            Fetch bulk and block deals from NSE

Options:
  --db PATH                 Override DB path (default: ~/.ethos/market-data/market.db)
  --help, -h                Show this help`);
    process.exit(0);
  }

  const store = new MarketDataStore(dbPath);

  try {
    switch (command) {
      // -----------------------------------------------------------------------
      case 'clean': {
        const { rowsDeleted } = store.clean();
        console.log(
          `Cleaned: ${rowsDeleted.ohlcv} OHLCV rows, ${rowsDeleted.syncMeta} sync records, ${rowsDeleted.watchlist} watchlist entries`,
        );
        break;
      }

      // -----------------------------------------------------------------------
      case 'backfill': {
        let symbols: string[];

        if (hasFlag(args, '--all')) {
          symbols = NSE_NIFTY50;
        } else {
          const symbolsFlag = getFlag(args, '--symbols');
          if (symbolsFlag) {
            symbols = symbolsFlag
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            const watchlistEntries = store.watchlistList();
            if (watchlistEntries.length === 0) {
              console.error(
                'No symbols specified. Use --symbols A,B,C or --all, or add symbols to your watchlist first.',
              );
              process.exit(1);
            }
            symbols = watchlistEntries.map((e) => e.symbol);
          }
        }

        const fromDate =
          getFlag(args, '--from') ??
          new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const results: SyncResult[] = [];
        let idx = 0;
        for (const sym of symbols) {
          idx++;
          process.stdout.write(`Backfilling ${sym} (${idx}/${symbols.length})... `);
          try {
            const r = await store.backfillSymbol(sym, fromDate);
            results.push(r);
            console.log(`${r.rowsInserted} rows inserted`);
          } catch (e) {
            console.log(`ERROR: ${(e as Error).message}`);
            results.push({ symbol: sym, rowsInserted: 0, fromDate, toDate: '' });
          }
        }

        const totalRows = results.reduce((s, r) => s + r.rowsInserted, 0);
        console.log(`Done. ${symbols.length} symbols, ${totalRows} total rows inserted.`);
        break;
      }

      // -----------------------------------------------------------------------
      case 'update': {
        const mode = getFlag(args, '--mode') ?? 'watchlist';

        if (mode === 'watchlist') {
          const watchlistEntries = store.watchlistList();
          console.log(`Updating ${watchlistEntries.length} watchlist symbols...`);
        }

        const results = mode === 'all' ? await store.updateAll() : await store.updateWatchlist();

        if (mode === 'all') {
          console.log(`Updating ${results.length} all symbols...`);
        }

        let totalRows = 0;
        for (const r of results) {
          if (r.rowsInserted > 0) {
            console.log(`  ${r.symbol}: +${r.rowsInserted} rows (up to ${r.toDate})`);
            totalRows += r.rowsInserted;
          } else {
            console.log(`  ${r.symbol}: already up to date`);
          }
        }

        const updated = results.filter((r) => r.rowsInserted > 0).length;
        console.log(`Done. ${updated} symbols updated, ${totalRows} new rows total.`);
        break;
      }

      // -----------------------------------------------------------------------
      case 'watchlist': {
        const subcommand = args[1];

        if (subcommand === 'add') {
          const symbol = args[2];
          if (!symbol) {
            console.error('Usage: watchlist add SYMBOL');
            process.exit(1);
          }
          const list = getFlag(args, '--list') ?? 'default';
          const notes = getFlag(args, '--notes');
          store.watchlistAdd(symbol, list, notes);
          console.log(
            notes
              ? `Added ${symbol} to watchlist '${list}' (notes: "${notes}")`
              : `Added ${symbol} to watchlist '${list}'`,
          );
        } else if (subcommand === 'remove') {
          const symbol = args[2];
          if (!symbol) {
            console.error('Usage: watchlist remove SYMBOL');
            process.exit(1);
          }
          const list = getFlag(args, '--list') ?? 'default';
          const before = store.watchlistList(list);
          store.watchlistRemove(symbol, list);
          const after = store.watchlistList(list);
          if (before.length === after.length) {
            console.log(`${symbol} not found in watchlist '${list}'`);
          } else {
            console.log(`Removed ${symbol} from watchlist '${list}'`);
          }
        } else if (subcommand === 'show') {
          const list = getFlag(args, '--list') ?? 'default';
          const entries = store.watchlistList(list);
          if (entries.length === 0) {
            console.log(`Watchlist '${list}' is empty.`);
          } else {
            console.log(`Watchlist '${list}' (${entries.length} symbols):`);
            for (const entry of entries) {
              const dateStr = new Date(entry.addedAt).toISOString().slice(0, 10);
              const notePart = entry.notes ? `  "${entry.notes}"` : '';
              console.log(`  ${entry.symbol.padEnd(20)} added ${dateStr}${notePart}`);
            }
          }
        } else {
          console.error(
            `Unknown watchlist subcommand: ${subcommand ?? '(none)'}. Use add, remove, or show.`,
          );
          process.exit(1);
        }
        break;
      }

      // -----------------------------------------------------------------------
      case 'history': {
        const symbol = args[1];
        if (!symbol) {
          console.error('Usage: history SYMBOL [--days N]');
          process.exit(1);
        }
        const days = parseInt(getFlag(args, '--days') ?? '252', 10);
        const rows = store.getHistory(symbol, days);
        if (rows.length === 0) {
          console.log(`No data for ${symbol}. Run backfill first.`);
        } else {
          console.log(`${symbol} — last ${rows.length} days`);
          console.log('Date         Open      High      Low       Close     Volume');
          for (const r of rows) {
            console.log(
              `${r.date}  ${String(r.open.toFixed(2)).padStart(9)}  ${String(r.high.toFixed(2)).padStart(9)}  ${String(r.low.toFixed(2)).padStart(9)}  ${String(r.close.toFixed(2)).padStart(9)}  ${String(r.volume).padStart(10)}`,
            );
          }
        }
        break;
      }

      // -----------------------------------------------------------------------
      case 'screen': {
        const list = getFlag(args, '--list') ?? 'default';
        const volumeSurgeFlag = getFlag(args, '--volume-surge');
        const nearHighFlag = getFlag(args, '--near-high');
        const minVolumeSurge =
          volumeSurgeFlag !== undefined ? parseFloat(volumeSurgeFlag) : undefined;
        const nearHighPct = nearHighFlag !== undefined ? parseFloat(nearHighFlag) : undefined;
        console.log(`Screening watchlist '${list}'...`);
        const rows = store.screen({ listName: list, minVolumeSurge, nearHighPct });
        if (rows.length === 0) {
          console.log('No symbols matched the screen criteria.');
        } else {
          console.log('Symbol               Close     VolSurge  From52wH%  52wH      52wL');
          for (const r of rows) {
            console.log(
              `${r.symbol.padEnd(20)} ${String(r.close.toFixed(2)).padStart(9)} ${`${r.volumeSurge.toFixed(1)}x`.padStart(9)} ${`${r.pctFrom52wHigh.toFixed(1)}%`.padStart(10)} ${String(r.high52w.toFixed(2)).padStart(9)} ${String(r.low52w.toFixed(2)).padStart(9)}`,
            );
          }
        }
        break;
      }

      // -----------------------------------------------------------------------
      case 'quote': {
        const symbol = args[1];
        if (!symbol) {
          console.error('Usage: quote SYMBOL');
          process.exit(1);
        }
        const q = await fetchQuote(symbol);
        console.log(q.name);
        console.log(
          `Price: ₹${q.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${q.currency}`,
        );
        console.log('(15-minute delayed data via Yahoo Finance)');
        break;
      }

      // -----------------------------------------------------------------------
      case 'refresh-instruments': {
        const pkgRoot = getPackageRoot();
        const instrumentsPath = join(pkgRoot, 'data', 'instruments.json');
        const constituentPath = join(pkgRoot, 'data', 'index_constituents.json');
        const instruments = JSON.parse(
          readFileSync(instrumentsPath, 'utf-8'),
        ) as InstrumentSeedRow[];
        const constituents = JSON.parse(
          readFileSync(constituentPath, 'utf-8'),
        ) as IndexConstituentSeedRow[];
        const instrResult = store.upsertInstruments(instruments);
        const constCount = store.upsertIndexConstituents(constituents);
        console.log(
          `Instruments: ${instrResult.upserted} upserted, ${instrResult.removed} removed. Index constituents: ${constCount} upserted.`,
        );
        break;
      }

      // -----------------------------------------------------------------------
      case 'refresh-scans': {
        const pkgRoot = getPackageRoot();
        const scansDir = join(pkgRoot, 'scans');
        const scanFiles = readJsonFilesRecursive(scansDir);
        const scans = scanFiles as SavedScanRow[];
        const scanResult = store.upsertScans(scans);
        console.log(`Scans: ${scanResult.upserted} upserted from scans/ directory.`);
        break;
      }

      // -----------------------------------------------------------------------
      case 'compute-indicators': {
        const symbolFlag = getFlag(args, '--symbol');
        const fromFlag = getFlag(args, '--from');
        const toFlag = getFlag(args, '--to');

        console.log('Computing indicators...');
        const result = await store.computeIndicators({
          symbol: symbolFlag,
          from: fromFlag,
          to: toFlag,
          adjusted: hasFlag(args, '--adjusted'),
        });
        console.log(`Done. Processed ${result.processed} symbols, ${result.dateCount} date(s).`);
        break;
      }

      // -----------------------------------------------------------------------
      case 'compute-sector-state': {
        const fromFlag = getFlag(args, '--from');
        const toFlag = getFlag(args, '--to');

        console.log('Computing sector state...');
        const result = store.computeSectorState({ from: fromFlag, to: toFlag });
        console.log(`Done. Processed ${result.processed} date(s).`);
        break;
      }

      // -----------------------------------------------------------------------
      case 'detect-splits': {
        const gapFlag = getFlag(args, '--gap');
        const threshold = gapFlag !== undefined ? parseFloat(gapFlag) : 0.4;

        const suspects = store.detectSplits(threshold);
        if (suspects.length === 0) {
          console.log('No suspicious overnight gaps found.');
        } else {
          console.log(
            `Found ${suspects.length} suspicious gap(s) (>${Math.round(threshold * 100)}% overnight):`,
          );
          console.log('Symbol               Date         Open      PrevClose  Gap%');
          for (const s of suspects) {
            console.log(
              `${s.symbol.padEnd(20)} ${s.date}  ${String(s.open.toFixed(2)).padStart(9)}  ${String(s.prevClose.toFixed(2)).padStart(9)}  ${(s.gapPct * 100).toFixed(1)}%`,
            );
          }
        }
        break;
      }

      // -----------------------------------------------------------------------
      case 'compute-market-state': {
        const fromFlag = getFlag(args, '--from');
        const toFlag = getFlag(args, '--to');

        console.log('Computing market state...');
        const result = store.computeMarketState({ from: fromFlag, to: toFlag });
        console.log(`Done. Processed ${result.processed} date(s).`);
        break;
      }

      // -----------------------------------------------------------------------
      case 'init': {
        const yearsFlag = getFlag(args, '--years');
        const years = yearsFlag !== undefined ? parseInt(yearsFlag, 10) : 5;
        const fromDate = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);

        console.log('Initializing NSE market data...');

        // Step 1: Seed instruments
        const pkgRoot = getPackageRoot();
        const instrumentsPath = join(pkgRoot, 'data', 'instruments.json');
        const constituentPath = join(pkgRoot, 'data', 'index_constituents.json');
        const instruments = JSON.parse(
          readFileSync(instrumentsPath, 'utf-8'),
        ) as InstrumentSeedRow[];
        const constituents = JSON.parse(
          readFileSync(constituentPath, 'utf-8'),
        ) as IndexConstituentSeedRow[];
        const instrResult = store.upsertInstruments(instruments);
        store.upsertIndexConstituents(constituents);
        console.log(
          `Instruments: ${instrResult.upserted} upserted, ${instrResult.removed} removed.`,
        );

        // Step 2: Seed scans
        const scansDir = join(pkgRoot, 'scans');
        const scanFiles = readJsonFilesRecursive(scansDir);
        const scans = scanFiles as SavedScanRow[];
        const scanResult = store.upsertScans(scans);
        console.log(`Scans: ${scanResult.upserted} loaded.`);

        // Step 3: Backfill index symbols + watchlist symbols
        const indexInstruments = store.getActiveInstrumentsByType('index');
        const indexSymbols = indexInstruments.map((i) => i.symbol);
        const watchlistEntries = store.watchlistList();
        const watchlistSymbols = watchlistEntries.map((e) => e.symbol);
        const symbolsToBackfill = [...new Set([...indexSymbols, ...watchlistSymbols])];

        console.log(
          `Backfilling ${symbolsToBackfill.length} symbols from ${fromDate} (${years} years)...`,
        );
        await store.backfillAll(symbolsToBackfill, fromDate, (done, total, symbol) => {
          process.stdout.write(`  [${done}/${total}] ${symbol}\r`);
        });
        console.log(`\nBackfill complete: ${symbolsToBackfill.length} symbols.`);

        // Step 4: Compute indicators
        console.log('Computing indicators...');
        const indicatorResult = await store.computeIndicators({ from: fromDate });
        console.log(
          `Indicators: ${indicatorResult.processed} symbols, ${indicatorResult.dateCount} date(s).`,
        );

        console.log('Init complete.');
        break;
      }

      // -----------------------------------------------------------------------
      case 'backtest': {
        const fromFlag = getFlag(args, '--from');
        const toFlag = getFlag(args, '--to');
        if (!fromFlag || !toFlag) {
          console.error(
            'Usage: backtest --from DATE --to DATE [--screen CONDITION] [--scan-id ID]',
          );
          process.exit(1);
        }

        const screenFlag = getFlag(args, '--screen');
        const scanIdFlag = getFlag(args, '--scan-id');
        const holdDays =
          getFlag(args, '--hold-days') !== undefined
            ? parseInt(getFlag(args, '--hold-days') as string, 10)
            : undefined;
        const stopAtrMult =
          getFlag(args, '--stop-atr-mult') !== undefined
            ? parseFloat(getFlag(args, '--stop-atr-mult') as string)
            : undefined;
        const benchmarkFlag = getFlag(args, '--benchmark');

        if (!screenFlag && !scanIdFlag) {
          console.error('Specify --screen CONDITION or --scan-id ID');
          process.exit(1);
        }

        console.log(`Running backtest from ${fromFlag} to ${toFlag}...`);
        const result = store.runBacktest({
          screen: screenFlag,
          scanId: scanIdFlag,
          from: fromFlag,
          to: toFlag,
          holdDays,
          stopAtrMult,
          benchmark: benchmarkFlag,
        });

        const s = result.summary;
        console.log(`\nTrades:          ${s.total_trades}`);
        if (s.total_trades === 0) {
          console.log('No trades matched the screen criteria in this date range.');
          break;
        }
        console.log(`Win rate:        ${(s.win_rate * 100).toFixed(1)}%`);
        console.log(
          `Avg gain (wins): ${s.avg_gain_wins >= 0 ? '+' : ''}${s.avg_gain_wins.toFixed(1)}%`,
        );
        console.log(`Avg loss:        ${s.avg_loss.toFixed(1)}%`);
        console.log(
          `Expectancy:      ${s.expectancy >= 0 ? '+' : ''}${s.expectancy.toFixed(1)}% per trade`,
        );
        console.log(`Max drawdown:    ${s.max_drawdown.toFixed(1)}%`);
        console.log(`Sharpe (approx): ${s.sharpe_approx.toFixed(2)}`);
        console.log(
          `Benchmark return over period: ${s.benchmark_return >= 0 ? '+' : ''}${s.benchmark_return.toFixed(1)}%`,
        );
        console.log(
          `Screen alpha:    ${s.screen_alpha >= 0 ? '+' : ''}${s.screen_alpha.toFixed(1)}%`,
        );
        console.log(`Avg hold:        ${s.avg_hold.toFixed(1)} trading days`);

        if (Object.keys(result.by_regime).length > 1) {
          console.log('\nBy regime:');
          for (const [regime, stats] of Object.entries(result.by_regime)) {
            console.log(
              `  ${regime.padEnd(12)} trades:${String(stats.trades).padStart(4)}  win:${(stats.win_rate * 100).toFixed(0).padStart(3)}%  expect:${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(1)}%`,
            );
          }
        }
        break;
      }

      // -----------------------------------------------------------------------
      case 'fetch-fii-dii': {
        const dateFlag = getFlag(args, '--date');
        const daysFlag = getFlag(args, '--days');
        const days = daysFlag ? parseInt(daysFlag, 10) : 1;
        if (days > 1) {
          let saved = 0;
          const today = new Date();
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            const rows = await fetchFiiDii(dateStr);
            if (rows.length > 0) saved += store.upsertFiiDii(rows);
          }
          console.log(`Saved ${saved} FII/DII rows`);
        } else {
          const rows = await fetchFiiDii(dateFlag);
          const saved = store.upsertFiiDii(rows);
          console.log(`Saved ${saved} FII/DII rows`);
        }
        break;
      }

      // -----------------------------------------------------------------------
      case 'fetch-corporate-actions': {
        const sym = getFlag(args, '--symbol');
        if (!sym) {
          console.error('--symbol required');
          process.exit(1);
        }
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const fromFlag = getFlag(args, '--from') ?? oneYearAgo.toISOString().slice(0, 10);
        const toFlag = getFlag(args, '--to') ?? new Date().toISOString().slice(0, 10);
        const rows = await fetchCorporateActions(sym, fromFlag, toFlag);
        const saved = store.upsertCorporateActions(rows);
        console.log(`Saved ${saved} corporate action rows for ${sym}`);
        break;
      }

      // -----------------------------------------------------------------------
      case 'fetch-bulk-block': {
        const dateFlag = getFlag(args, '--date') ?? new Date().toISOString().slice(0, 10);
        const rows = await fetchBulkBlockDeals(dateFlag);
        const saved = store.upsertBulkBlockDeals(rows);
        console.log(`Saved ${saved} bulk/block deal rows for ${dateFlag}`);
        break;
      }

      // -----------------------------------------------------------------------
      default: {
        console.error(`Unknown command: ${command}. Run nse-market-data --help for usage.`);
        process.exit(1);
      }
    }
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
