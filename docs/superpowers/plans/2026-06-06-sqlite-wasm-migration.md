# SQLite WASM Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `better-sqlite3` (native C++ bindings) with `node-sqlite3-wasm` (pure WASM) to eliminate cross-platform compilation issues.

**Architecture:** Direct dependency swap. The two libraries have similar synchronous APIs but differ in: import style (named vs default export), parameter passing (array vs spread), statement lifecycle (manual finalize required), transaction API (manual BEGIN/COMMIT vs built-in helper), and pragma syntax (no `.pragma()` method). A small `runTransaction` helper replaces the built-in `db.transaction()`.

**Tech Stack:** node-sqlite3-wasm, TypeScript, vitest, tsup

**Spec:** `docs/superpowers/specs/2026-06-06-sqlite-wasm-migration-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Swap deps, update postinstall |
| `src/schema.ts` | Modify | Type import, pragma syntax |
| `src/store.ts` | Modify | Import, transaction helper, all DB calls |
| `src/seed.ts` | Modify | Dynamic import, readonly option, DB calls |
| `src/tools.ts` | Modify | Type casts (2 locations) |
| `src/postinstall.ts` | No change | Pure Node.js streams, no SQLite imports |
| `src/__tests__/store.test.ts` | Modify | Type casts, param arrays |

---

### Task 1: Swap dependencies in package.json

**Files:**
- Modify: `package.json:63-74`

- [ ] **Step 1: Install node-sqlite3-wasm and remove better-sqlite3**

Run:
```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npm uninstall better-sqlite3 @types/better-sqlite3
npm install node-sqlite3-wasm
```

- [ ] **Step 2: Update postinstall script**

In `package.json`, change the `postinstall` script from:
```json
"postinstall": "npm rebuild better-sqlite3 && (test -f dist/postinstall.js && node dist/postinstall.js || true)"
```
to:
```json
"postinstall": "test -f dist/postinstall.js && node dist/postinstall.js || true"
```

- [ ] **Step 3: Verify package.json is correct**

Run:
```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
cat package.json | grep -A2 'node-sqlite3-wasm'
cat package.json | grep 'better-sqlite3'  # Should return nothing
cat package.json | grep 'postinstall'
```

Expected:
- `node-sqlite3-wasm` appears in dependencies
- `better-sqlite3` does NOT appear anywhere
- `@types/better-sqlite3` does NOT appear anywhere
- postinstall has no `npm rebuild` prefix

---

### Task 2: Migrate schema.ts

**Files:**
- Modify: `src/schema.ts:1,283,289-291`

- [ ] **Step 1: Update the type import**

Change line 1 from:
```typescript
import type Database from 'better-sqlite3';
```
to:
```typescript
import type { Database } from 'node-sqlite3-wasm';
```

- [ ] **Step 2: Update the addColumnIfNotExists helper**

The function at line 278 uses `db.prepare(...).all()` which returns rows. In `node-sqlite3-wasm`, no-param calls work the same. But the statement must be finalized. Change the function body (lines 283-286) from:

```typescript
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
  }
```

to:

```typescript
  const stmt = db.prepare(`PRAGMA table_info("${table}")`);
  const cols = stmt.all() as Array<{ name: string }>;
  stmt.finalize();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
  }
```

- [ ] **Step 3: Update the migrate function signature and pragma calls**

Change the `migrate` function (lines 289-291). The function signature type changes from `Database.Database` to `Database`:

```typescript
export function migrate(db: Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
```

The rest of the function body (lines 292+) uses only `db.exec()` calls which are the same in both libraries. No changes needed there.

- [ ] **Step 4: Verify schema.ts compiles**

Run:
```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npx tsc --noEmit src/schema.ts 2>&1 | head -20
```

Expected: No errors related to schema.ts (other files may error since they haven't been migrated yet).

---

### Task 3: Migrate store.ts — imports, types, and transaction helper

**Files:**
- Modify: `src/store.ts:4,303,309`

This task handles the structural changes. Task 4 handles the mechanical param-wrapping across all methods.

- [ ] **Step 1: Update the import**

Change line 4 from:
```typescript
import Database from 'better-sqlite3';
```
to:
```typescript
import { Database } from 'node-sqlite3-wasm';
```

- [ ] **Step 2: Add the runTransaction helper**

Add this function right after the imports and before the class definition. Find a good spot after all the import statements and type definitions but before `export class MarketDataStore`. The helper:

```typescript
function runTransaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
```

- [ ] **Step 3: Update the class field type**

Change line 303 from:
```typescript
  private readonly db: Database.Database;
```
to:
```typescript
  private readonly db: Database;
```

- [ ] **Step 4: Update the constructor**

The constructor at line 309 `this.db = new Database(dbPath);` — this stays the same. No change needed. The `new Database(path)` constructor is identical in both libraries.

---

### Task 4: Migrate store.ts — all transaction blocks

**Files:**
- Modify: `src/store.ts` — 10 transaction sites

Every `this.db.transaction(fn)` call must be replaced with `runTransaction(this.db, () => { ... })`. The prepared statement used inside the transaction must be finalized after the transaction completes.

Below are ALL 10 transaction sites. Each follows the same pattern.

- [ ] **Step 1: Migrate `clean()` (line 353)**

From:
```typescript
  clean(): { rowsDeleted: { ohlcv: number; watchlist: number; syncMeta: number } } {
    const cleanTx = this.db.transaction(() => {
      const ohlcv = this.db.prepare('DELETE FROM ohlcv_daily').run().changes;
      const watchlist = this.db.prepare('DELETE FROM watchlist').run().changes;
      const syncMeta = this.db.prepare('DELETE FROM sync_meta').run().changes;
      return { ohlcv, watchlist, syncMeta };
    });
    const result = cleanTx() as { ohlcv: number; watchlist: number; syncMeta: number };
    return { rowsDeleted: result };
  }
```

To:
```typescript
  clean(): { rowsDeleted: { ohlcv: number; watchlist: number; syncMeta: number } } {
    const result = runTransaction(this.db, () => {
      const s1 = this.db.prepare('DELETE FROM ohlcv_daily');
      const ohlcv = s1.run().changes;
      s1.finalize();
      const s2 = this.db.prepare('DELETE FROM watchlist');
      const watchlist = s2.run().changes;
      s2.finalize();
      const s3 = this.db.prepare('DELETE FROM sync_meta');
      const syncMeta = s3.run().changes;
      s3.finalize();
      return { ohlcv, watchlist, syncMeta };
    });
    return { rowsDeleted: result };
  }
```

- [ ] **Step 2: Migrate `insertOhlcv()` (line 716)**

From:
```typescript
  insertOhlcv(rows: OhlcvRow[]): number {
    if (rows.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ohlcv_daily (symbol, date, open, high, low, close, volume, adj_close, adj_factor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMany = this.db.transaction((items: OhlcvRow[]) => {
      for (const r of items) {
        stmt.run(
          r.symbol, r.date, r.open, r.high, r.low, r.close,
          Math.round(r.volume), r.adjClose ?? null,
          r.adjClose !== null && r.close > 0 ? r.adjClose / r.close : null,
        );
      }
    });
    insertMany(rows);
    return rows.length;
  }
```

To:
```typescript
  insertOhlcv(rows: OhlcvRow[]): number {
    if (rows.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ohlcv_daily (symbol, date, open, high, low, close, volume, adj_close, adj_factor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    runTransaction(this.db, () => {
      for (const r of rows) {
        stmt.run([
          r.symbol, r.date, r.open, r.high, r.low, r.close,
          Math.round(r.volume), r.adjClose ?? null,
          r.adjClose !== null && r.close > 0 ? r.adjClose / r.close : null,
        ]);
      }
    });
    stmt.finalize();
    return rows.length;
  }
```

- [ ] **Step 3: Migrate `upsertInstruments()` (line 745)**

From:
```typescript
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO instruments ...  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const upsertTx = this.db.transaction((items: InstrumentSeedRow[]) => {
      for (const r of items) {
        stmt.run(
          r.symbol, r.name, r.exchange ?? 'NSE', r.sector ?? null, r.isin ?? null, Date.now(),
          r.industry ?? null, r.market_cap_band ?? null, r.instrument_type ?? 'equity',
          r.index_category ?? null, r.is_active ?? 1, r.as_of_date ?? null,
        );
      }
    });
    upsertTx(rows);
```

To:
```typescript
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO instruments ...  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    runTransaction(this.db, () => {
      for (const r of rows) {
        stmt.run([
          r.symbol, r.name, r.exchange ?? 'NSE', r.sector ?? null, r.isin ?? null, Date.now(),
          r.industry ?? null, r.market_cap_band ?? null, r.instrument_type ?? 'equity',
          r.index_category ?? null, r.is_active ?? 1, r.as_of_date ?? null,
        ]);
      }
    });
    stmt.finalize();
```

Then the DELETE after the transaction (line 776-779) also needs array params. Change:
```typescript
      const result = this.db
        .prepare(`DELETE FROM instruments WHERE symbol NOT IN (${placeholders})`)
        .run(...symbols);
      removed = result.changes;
```
to:
```typescript
      const delStmt = this.db.prepare(`DELETE FROM instruments WHERE symbol NOT IN (${placeholders})`);
      const result = delStmt.run(symbols);
      delStmt.finalize();
      removed = result.changes;
```

Note: `symbols` is already an array, so pass it directly — no wrapping needed.

- [ ] **Step 4: Migrate `upsertIndexConstituents()` (line 785)**

Same pattern. Change `this.db.transaction((items) => { ... }); upsertTx(rows);` to `runTransaction(this.db, () => { ... }); stmt.finalize();` and wrap `.run()` params in arrays:

```typescript
    runTransaction(this.db, () => {
      for (const r of rows) {
        stmt.run([r.index_symbol, r.member_symbol, r.weight ?? null, r.as_of_date]);
      }
    });
    stmt.finalize();
```

- [ ] **Step 5: Migrate `upsertScans()` (line 801)**

Same pattern:
```typescript
    runTransaction(this.db, () => {
      for (const s of scans) {
        stmt.run([
          s.scan_id, s.name, s.category, s.description ?? null,
          s.sql_template, s.tags != null ? JSON.stringify(s.tags) : null, s.is_builtin ?? 1,
        ]);
      }
    });
    stmt.finalize();
```

- [ ] **Step 6: Migrate `computeIndicators()` Pass 1 transaction (line 2008)**

Same pattern — the `upsertStmt` prepared before the loop, transaction wraps the batch insert, finalize after. The upsert has ~60 indicator columns. Keep the existing parameter list from the current code and wrap it in `[...]`:

```typescript
    runTransaction(this.db, () => {
      for (const r of indicatorRows) {
        upsertStmt.run([
          r.symbol, r.date, r.ema_20, r.ema_50, r.ema_100, r.ema_200,
          // ... keep ALL existing params from the current stmt.run() call,
          // just wrap the outer parentheses with square brackets
        ]);
      }
    });
    upsertStmt.finalize();
```

The implementer should copy the exact parameter list from the current `upsertStmt.run(...)` call and change `upsertStmt.run(p1, p2, ...)` to `upsertStmt.run([p1, p2, ...])`. Do NOT rewrite or reorder the params.

- [ ] **Step 7: Migrate `computeIndicators()` Pass 2 transaction (line 2171)**

The `updateTx` at line 2171 is more complex — it has inner `db.prepare().get()` calls inside the transaction loop. These inner statements also need finalization. Change the pattern to:

```typescript
    runTransaction(this.db, () => {
      for (const r of crossRows) {
        // ... percentile rank computation ...
        const idStmt = this.db.prepare(`SELECT ... FROM indicators_daily WHERE symbol=? AND date=?`);
        const idRow = idStmt.get([r.symbol, date]) as ... | undefined;
        idStmt.finalize();

        if (!idRow) continue;

        // ... sniper/composite computation ...

        const setupStmt = this.db.prepare(`SELECT ... FROM indicators_daily WHERE symbol=? AND date=?`);
        const setupRow = setupStmt.get([r.symbol, date]) as ... | undefined;
        setupStmt.finalize();

        // ... setup type computation ...

        updateStmt.run([
          rsRankInSegment, rsRankInSector,
          sniperResult.score, sniperResult.verdict,
          compositeResult.score, compositeResult.grade,
          setupResult?.type ?? null, setupResult?.quality ?? null,
          r.symbol, date,
        ]);
      }
    });
    updateStmt.finalize();
```

- [ ] **Step 8: Migrate `upsertFiiDii()` (line 3224)**

```typescript
    runTransaction(this.db, () => {
      for (const r of rows) {
        stmt.run([r.date, r.fii_buy, r.fii_sell, r.fii_net, r.dii_buy, r.dii_sell, r.dii_net]);
        count++;
      }
    });
    stmt.finalize();
```

- [ ] **Step 9: Migrate `upsertCorporateActions()` (line 3266)**

```typescript
    runTransaction(this.db, () => {
      for (const r of rows) {
        stmt.run([r.symbol, r.ex_date, r.purpose, r.value ?? null]);
        count++;
      }
    });
    stmt.finalize();
```

- [ ] **Step 10: Migrate `upsertBulkBlockDeals()` (line 3303)**

```typescript
    runTransaction(this.db, () => {
      for (const r of rows) {
        stmt.run([r.date, r.symbol, r.client_name, r.deal_type, r.trade_type, r.quantity, r.price]);
        count++;
      }
    });
    stmt.finalize();
```

---

### Task 5: Migrate store.ts — all non-transaction prepared statements

**Files:**
- Modify: `src/store.ts` — all inline `.prepare().run/get/all()` chains

Every inline `this.db.prepare(sql).run(a, b, c)` chain needs two changes:
1. Wrap params in an array: `.run([a, b, c])`
2. Add `stmt.finalize()` — but for inline chains, restructure to: prepare → execute → finalize

This task is mechanical. The pattern is always the same:

**Before (inline chain):**
```typescript
this.db.prepare('INSERT ... VALUES (?, ?, ?)').run(a, b, c);
```

**After:**
```typescript
const stmt = this.db.prepare('INSERT ... VALUES (?, ?, ?)');
stmt.run([a, b, c]);
stmt.finalize();
```

**For `.get()` and `.all()` that return values:**
```typescript
// Before:
const row = this.db.prepare('SELECT ... WHERE symbol = ?').get(symbol) as Type;

// After:
const stmt = this.db.prepare('SELECT ... WHERE symbol = ?');
const row = stmt.get([symbol]) as Type;
stmt.finalize();
```

- [ ] **Step 1: Migrate all `.run()` inline chains**

Search for all occurrences with:
```bash
rg -n '\.prepare\(.*\)[\s\n]*\.run\(' src/store.ts
```

Convert each one. Key locations include:
- Line 372-374: `backfillSymbol` — INSERT OR REPLACE into sync_meta
- Line 604: `watchlistAdd` — INSERT OR REPLACE into watchlist
- Line 609: `watchlistRemove` — DELETE FROM watchlist

- [ ] **Step 2: Migrate all `.get()` inline chains**

Search for all occurrences with:
```bash
rg -n '\.prepare\(.*\)[\s\n]*\.get\(' src/store.ts
```

Convert each one. Key locations include:
- Line 538: `updateSymbol` — SELECT last_date FROM sync_meta
- Line 848-852: `getScan` — SELECT from saved_scans
- Line 2184-2190: inner query in computeIndicators Pass 2
- Line 2219-2227: inner query in computeIndicators Pass 2
- Line 3256: `getFiiDii` — SELECT latest row

- [ ] **Step 3: Migrate all `.all()` inline chains**

Search for all occurrences with:
```bash
rg -n '\.prepare\(.*\)[\s\n]*\.all\(' src/store.ts
```

Convert each one. Key locations include:
- Line 531-533: `getIndexConstituents` — SELECT with param
- Line 556: `updateWatchlist` — SELECT DISTINCT
- Line 577: `updateAll` — SELECT
- Line 614-618: `watchlistList` — SELECT with param
- Line 831-840: `listScans` — SELECT (no params — `.all()` unchanged but add finalize)
- Line 858: `runScan` — SELECT (no params)
- Line 874: `runScan` (wrapped query, no params)
- Line 878: `listInstrumentSymbols` — SELECT (no params)
- Line 887-895: `getActiveInstrumentsByType` — SELECT with param
- Line 3247-3248: `getFiiDii` with days param
- Line 3252-3253: `getFiiDii` with date param
- Line 3296: `getCorporateActions` — SELECT with spread params

**Special case — `getCorporateActions()` line 3296:**
```typescript
// Before:
return this.db.prepare(sql).all(...params) as CorporateActionDbRow[];

// After:
const stmt = this.db.prepare(sql);
const result = stmt.all(params) as CorporateActionDbRow[];
stmt.finalize();
return result;
```
Note: `params` is already an `unknown[]`, so pass directly — no wrapping.

- [ ] **Step 4: Verify no `.run()`, `.get()`, `.all()` calls remain with spread params**

Run:
```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
rg '\.run\(' src/store.ts | grep -v 'stmt\.run\(\[' | grep -v '\.run\(\)'
```

Expected: No matches (all `.run()` calls either use array params `stmt.run([...])` or are no-arg `stmt.run()`).

---

### Task 6: Migrate seed.ts

**Files:**
- Modify: `src/seed.ts:100-196`

- [ ] **Step 1: Update the dynamic import**

Change line 101 from:
```typescript
  const Database = (await import('better-sqlite3')).default;
```
to:
```typescript
  const { Database } = await import('node-sqlite3-wasm');
```

- [ ] **Step 2: Update constructor options**

Change line 102 from:
```typescript
  const tempDb = new Database(tempDbPath, { readonly: true });
```
to:
```typescript
  const tempDb = new Database(tempDbPath, { readOnly: true });
```

Line 103 stays the same: `const localDb = new Database(localDbPath);`

- [ ] **Step 3: Update all prepared statement calls with param arrays and finalization**

The `mergeNewSymbols` function has several prepared statements. Each needs array params and finalization. The key changes:

**Lines 107-109 (remote symbols query):**
```typescript
    const remoteStmt = tempDb.prepare('SELECT DISTINCT symbol FROM ohlcv_daily');
    const remoteSymbols = (remoteStmt.all() as { symbol: string }[]).map((r) => r.symbol);
    remoteStmt.finalize();
```

**Lines 111-115 (local synced query):**
```typescript
    const localStmt = localDb.prepare('SELECT symbol FROM sync_meta');
    const localSynced = new Set(
      (localStmt.all() as { symbol: string }[]).map((r) => r.symbol),
    );
    localStmt.finalize();
```

**Lines 124-128 (insert statement):**
Keep the prepare as-is but later finalize.

**Lines 130-187 (transaction block):** Replace `localDb.transaction(() => { ... }); copyBatch();` with a `runTransaction` pattern. Since `seed.ts` doesn't import from store, duplicate the helper locally or inline BEGIN/COMMIT:

```typescript
    localDb.exec('BEGIN');
    try {
      for (const symbol of newSymbols) {
        const selectStmt = tempDb.prepare('SELECT * FROM ohlcv_daily WHERE symbol = ?');
        const rows = selectStmt.all([symbol]) as Record<string, unknown>[];
        selectStmt.finalize();
        for (const row of rows) {
          insertStmt.run([
            row.symbol, row.date, row.open, row.high, row.low, row.close,
            row.volume, row.adj_close, row.adj_factor, row.delivery_qty, row.delivery_pct,
          ]);
        }
        const metaStmt = tempDb.prepare('SELECT * FROM sync_meta WHERE symbol = ?');
        const meta = metaStmt.get([symbol]) as { last_sync: number; last_date: string } | undefined;
        metaStmt.finalize();
        if (meta) {
          const insertMeta = localDb.prepare(
            'INSERT OR IGNORE INTO sync_meta (symbol, last_sync, last_date) VALUES (?, ?, ?)',
          );
          insertMeta.run([symbol, meta.last_sync, meta.last_date]);
          insertMeta.finalize();
        }
        const instStmt = tempDb.prepare('SELECT * FROM instruments WHERE symbol = ?');
        const inst = instStmt.get([symbol]) as Record<string, unknown> | undefined;
        instStmt.finalize();
        if (inst) {
          const insertInst = localDb.prepare(
            `INSERT OR IGNORE INTO instruments
             (symbol, name, exchange, sector, industry, isin, market_cap_band, instrument_type, index_category, is_active, as_of_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          insertInst.run([
            inst.symbol, inst.name, inst.exchange, inst.sector, inst.industry,
            inst.isin, inst.market_cap_band, inst.instrument_type, inst.index_category,
            inst.is_active, inst.as_of_date,
          ]);
          insertInst.finalize();
        }
      }
      localDb.exec('COMMIT');
    } catch (e) {
      localDb.exec('ROLLBACK');
      throw e;
    }
    insertStmt.finalize();
```

- [ ] **Step 4: Verify seed.ts compiles**

Run:
```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npx tsc --noEmit src/seed.ts 2>&1 | head -20
```

---

### Task 7: Migrate tools.ts

**Files:**
- Modify: `src/tools.ts:464,620`

- [ ] **Step 1: Update both type casts**

Change line 464 from:
```typescript
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
```
to:
```typescript
    const db = (store as unknown as { db: import('node-sqlite3-wasm').Database }).db;
```

Change line 620 the same way:
```typescript
    const db = (store as unknown as { db: import('node-sqlite3-wasm').Database }).db;
```

- [ ] **Step 2: Update all prepared statement calls in tools.ts**

Search for all `.prepare().get()` and `.prepare().all()` calls in tools.ts and add array params + finalization. Key locations:

Line 467-469 (scan lookup):
```typescript
    const scanStmt = db.prepare('SELECT sql_template, name FROM saved_scans WHERE scan_id = ?');
    const scanRow = scanStmt.get([args.scan_id]) as { sql_template: string; name: string } | undefined;
    scanStmt.finalize();
```

Do the same for every other `db.prepare()` chain in tools.ts (check lines 482, and any other `.prepare()` calls in the `nseMarketRunScanTool` and `nseInvokeSkillTool` execute functions).

---

### Task 8: Migrate tests

**Files:**
- Modify: `src/__tests__/store.test.ts:398,421`

- [ ] **Step 1: Update both type casts**

Change line 398 from:
```typescript
      const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
```
to:
```typescript
      const db = (store as unknown as { db: import('node-sqlite3-wasm').Database }).db;
```

Change line 421 the same way.

- [ ] **Step 2: Update prepared statement calls in tests**

Lines 399-401 (adj_factor check):
```typescript
      const stmt = db.prepare('SELECT adj_factor FROM ohlcv_daily WHERE symbol = ?');
      const row = stmt.get(['TEST.NS']) as { adj_factor: number | null };
      stmt.finalize();
```

Lines 422-424 (null adj_factor check):
```typescript
      const stmt = db.prepare('SELECT adj_factor FROM ohlcv_daily WHERE symbol = ?');
      const row = stmt.get(['TEST.NS']) as { adj_factor: number | null };
      stmt.finalize();
```

---

### Task 9: Build, typecheck, lint, and test

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npm run typecheck
```

Expected: No errors. Fix any type mismatches (most likely `Database.Database` → `Database` references that were missed).

- [ ] **Step 2: Run lint**

```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npm run lint
```

Expected: Clean or only pre-existing warnings. Fix any new lint issues.

- [ ] **Step 3: Run tests**

```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npm run test
```

Expected: All tests pass. If any fail, check:
- Parameter array wrapping (most common issue)
- Missing `stmt.finalize()` calls (would show as WASM memory warnings, not test failures)
- Transaction helper (BEGIN/COMMIT ordering)

- [ ] **Step 4: Run full check**

```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npm run check
```

Expected: All three (typecheck + lint + test) pass.

- [ ] **Step 5: Run a quick smoke test with a real database**

```bash
cd /Users/mitesh/personal/sandbox/tools-nse-market-data
npm run build
node --input-type=module -e "
import { MarketDataStore } from './dist/index.js';
const store = new MarketDataStore('/tmp/test-wasm-migration.db');
store.insertOhlcv([{symbol:'TEST.NS',date:'2025-01-01',open:100,high:110,low:90,close:105,volume:1000,adjClose:100}]);
const rows = store.getHistory('TEST.NS');
console.log('rows:', rows.length);
store.close();
console.log('Smoke test passed');
"
rm -f /tmp/test-wasm-migration.db
```

Expected: `rows: 1` and `Smoke test passed`.
