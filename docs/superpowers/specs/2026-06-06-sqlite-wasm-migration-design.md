# SQLite WASM Migration: better-sqlite3 → node-sqlite3-wasm

**Date:** 2026-06-06
**Status:** Approved
**Scope:** tools-nse-market-data

## Problem

`better-sqlite3` requires native C++ compilation via `node-gyp` on every platform/architecture/Node version combination. This causes build failures across Mac, Ubuntu, Windows, Electron, and CI environments. The maintainer has closed both the ESM and WASM feature requests.

## Decision

Replace `better-sqlite3` with `node-sqlite3-wasm` — a pure WASM build of SQLite with a synchronous API, persistent on-disk storage via custom VFS, and zero native compilation. No backward compatibility with existing databases; everything moves to a fresh database.

## API Migration Map

| Feature | `better-sqlite3` | `node-sqlite3-wasm` |
|---------|------------------|---------------------|
| Import | `import Database from 'better-sqlite3'` | `import { Database } from 'node-sqlite3-wasm'` |
| Constructor | `new Database(path)` | `new Database(path)` |
| Constructor (readonly) | `{ readonly: true }` | `{ readOnly: true }` |
| `db.pragma()` | `db.pragma('journal_mode = WAL')` | `db.exec('PRAGMA journal_mode = WAL')` |
| `db.exec()` | Returns `this` (chainable) | Returns `void` |
| `db.prepare()` | Returns Statement | Returns Statement |
| `stmt.run()` | `stmt.run(a, b, c)` spread params | `stmt.run([a, b, c])` array param |
| `stmt.get()` | `stmt.get(a, b)` spread params | `stmt.get([a, b])` array param |
| `stmt.all()` | `stmt.all(a, b)` spread params | `stmt.all([a, b])` array param |
| `stmt.finalize()` | Not needed | Required (prevents WASM memory leaks) |
| `db.transaction(fn)` | Built-in | Does not exist — use helper |
| `db.close()` | Returns `this` | Returns `void` |
| `db.inTransaction` | Exists | Exists |
| Foreign keys | Manual pragma required | Enabled by default |
| Types | `@types/better-sqlite3` (devDep) | Built-in `.d.ts` |

## Files to Modify

### 1. `package.json`

- Remove `better-sqlite3` from dependencies
- Remove `@types/better-sqlite3` from devDependencies
- Add `node-sqlite3-wasm` to dependencies
- Update postinstall: remove `npm rebuild better-sqlite3 &&` prefix
- New postinstall: `test -f dist/postinstall.js && node dist/postinstall.js || true`

### 2. `src/schema.ts`

- Change type import: `import type { Database } from 'node-sqlite3-wasm'`
- Update `migrate()` function signature to accept new Database type
- Replace `db.pragma('journal_mode = WAL')` → `db.exec('PRAGMA journal_mode = WAL')`
- Replace `db.pragma('foreign_keys = ON')` → remove (enabled by default) or keep as explicit `db.exec('PRAGMA foreign_keys = ON')`

### 3. `src/store.ts`

**Import:**
- `import { Database } from 'node-sqlite3-wasm'`

**Transaction helper** (add near top of file):
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

**All prepared statement calls** — wrap params in arrays:
- `stmt.run(a, b, c)` → `stmt.run([a, b, c])`
- `stmt.get(a, b)` → `stmt.get([a, b])`
- `stmt.all(a, b)` → `stmt.all([a, b])`
- `stmt.run()` with no params → `stmt.run()` (unchanged)
- `stmt.all()` with no params → `stmt.all()` (unchanged)

**All transaction blocks** — replace pattern:
```typescript
// Before:
const txFn = this.db.transaction((items) => { ... });
txFn(items);

// After:
runTransaction(this.db, () => { ... use items directly ... });
```

**Statement finalization** — every `db.prepare()` call must have a matching `stmt.finalize()`. Two patterns:
- **One-shot statements** (prepare → run/get/all → finalize immediately):
  ```typescript
  const stmt = this.db.prepare('SELECT ...');
  const result = stmt.all([param]);
  stmt.finalize();
  ```
- **Statements inside transactions** (prepare before transaction, finalize after):
  ```typescript
  const stmt = this.db.prepare('INSERT ...');
  runTransaction(this.db, () => {
    for (const item of items) stmt.run([item.a, item.b]);
  });
  stmt.finalize();
  ```

### 4. `src/seed.ts`

- Dynamic import: `const { Database } = await import('node-sqlite3-wasm')`
- Constructor option: `{ readonly: true }` → `{ readOnly: true }`
- All `stmt.run/get/all` calls: wrap params in arrays
- Add `stmt.finalize()` calls
- Replace any transaction patterns with `runTransaction` helper (import from store or duplicate)

### 5. `src/tools.ts`

- Update type casts from `import('better-sqlite3').Database` → `import('node-sqlite3-wasm').Database`
- Two locations: `nseMarketRunScanTool` and `nseInvokeSkillTool`

### 6. `src/__tests__/store.test.ts`

- Update type casts from `import('better-sqlite3').Database` → `import('node-sqlite3-wasm').Database`
- All direct `db.prepare().run/get/all` calls in tests: wrap params in arrays
- Add finalize calls where statements are used directly

## Postinstall Simplification

**Before:**
```
npm rebuild better-sqlite3 && (test -f dist/postinstall.js && node dist/postinstall.js || true)
```

**After:**
```
test -f dist/postinstall.js && node dist/postinstall.js || true
```

The `npm rebuild` step is eliminated entirely — no native code to compile.

## Seed Database

- Existing `data/seed.db.gz` will be regenerated using `node-sqlite3-wasm`
- SQLite file format is universal — the file is identical regardless of which library created it
- `postinstall.ts` decompression logic stays the same (gunzip stream)
- `mergeNewSymbols()` in `seed.ts` adapts with the same API changes as `store.ts`

## What We Are NOT Doing

- No backward compatibility with existing better-sqlite3 databases
- No adapter or abstraction layer between the app and the SQLite library
- No async API refactoring
- No ORM introduction
- No WAL mode validation (will test during implementation; fallback to journal_mode=DELETE if WASM VFS does not support WAL shared memory)

## Performance

WASM SQLite is ~2-4x slower than native better-sqlite3 on bulk inserts. For this project's workload (daily OHLCV syncs, batch indicator computation, watchlist queries), this is acceptable. The tool is not used for real-time trading.

## Ethos Migration Notes

The design above is scoped to tools-nse-market-data. When extending this migration to ethos's session-sqlite, three additional amendments are required:

### 1. FTS5 Porter Tokenizer (Hard Blocker)

`session-sqlite/src/index.ts:107` creates an FTS5 table with `tokenize='porter ascii'`. The porter stemmer is an optional compile-time feature likely absent from the prebuilt node-sqlite3-wasm WASM binary — only `unicode61` and `ascii` are guaranteed. If porter is absent, `CREATE VIRTUAL TABLE ... USING fts5(... tokenize='porter ascii')` throws at startup, breaking the entire session store.

**Resolution options:**
- Confirm porter is compiled into the node-sqlite3-wasm binary (test at runtime before shipping)
- Fall back to `tokenize='ascii'` — acceptable, just degrades stem matching
- Build a custom WASM binary with porter enabled (high effort, last resort)

### 2. Row-Returning `db.pragma()` Calls

The tools-nse-market-data spec covers `db.pragma()` only as a setter (`journal_mode = WAL`). Ethos also uses it as a query that returns rows:

```typescript
const cols = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
```

`node-sqlite3-wasm` has no `pragma()` method. The replacement is:

```typescript
const stmt = this.db.prepare('PRAGMA table_info(messages)');
const cols = stmt.all([]) as Array<{ name: string }>;
stmt.finalize();
```

This pattern must be applied at lines 143, 150, 157, and 163 of session-sqlite's store.

### 3. Statement Finalization in Long-Running Processes

tools-nse-market-data is a short-lived CLI — unfinalised statements are cleaned up at process exit. Ethos's session store is long-running; every agent turn calls `appendMessage`, `getMessages`, `updateUsage`, `recordTurnStart`, etc. Each inline `this.db.prepare('...').run(...)` without `finalize()` leaks WASM memory.

**Resolution options:**
- **Inline finalize** — finalize immediately after every one-shot prepare/run/get/all call (verbose but safe)
- **Cached statements** — store frequently-used prepared statements as class properties, finalize them all in `close()` (better performance, cleaner code)
- **Helper method** — add a `run(sql, params)` / `get(sql, params)` / `all(sql, params)` method on the store that handles prepare + execute + finalize internally

The cached-statements approach is recommended for ethos: it avoids per-call prepare overhead AND prevents leaks.

### 4. WAL Mode Verification

The WAL uncertainty flagged in the main spec is more load-bearing in ethos than in tools-nse-market-data. Ethos has concurrent reads during agent execution. WAL mode must be explicitly tested with the WASM VFS before shipping — if unsupported, fall back to `journal_mode=DELETE` and accept the concurrency limitation.

## Verification

After migration:
- `make check` must pass (typecheck + lint + test)
- All 14 tables must create correctly with STRICT mode
- Seed database must decompress and open successfully
- `mergeNewSymbols()` must work with the new library
- Basic CRUD operations must work: insert OHLCV, query history, manage watchlist
