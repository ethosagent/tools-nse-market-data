# query-and-instrument-tools

Status: **Implemented** (Phases 1–3 equivalent; Phase 4 deferred) | Date: 2026-08-06,
implementation notes 2026-08-07 | Scope: Two new tools + one behaviour change in
@ethosagent/tools-nse-market-data

Owner review folded in 2026-08-06 (D1–D5, §1.1). A second owner review on 2026-08-07 added
**D6 (no `source` column)** and **D7 (soft delete instead of hard delete)**, which supersede
the migration this spec originally proposed. Both are folded in below; §4 has been rewritten
from "the migration" to "the soft delete". Q2 closed by D5, Q3 closed by D6 (there is no
migration left to version), Q4 and Q5 remain open, Q1 is answered by shipping without the
timeout as recommended.

## 1. Overview

Two independent additions, shipped together because both touch `instruments` and both
add tools to `src/tools.ts`.

**Requirement 1 — `nse_market_query`.** A read-only SQL escape hatch. All 24 existing
tools are task-shaped; the closest to flexible, `nse_market_screen`, takes three fixed
filters and emits hardcoded columns. The data is local SQLite, so the only thing standing
between the model and an arbitrary question is the absence of a query surface. This adds
one, structurally sandboxed, JSON-returning, and on its own toolset so it can be withheld.

**Requirement 2 — `nse_instrument_add`.** Today there is no way to register a symbol the
seed data missed without editing `data/instruments.json` and re-running
`refresh-instruments`. One tool makes curation a first-class operation — for equities and,
via `instrument_type: 'index'` plus an optional `members` list, for indices too (D5, and see
§6). It ships with one behaviour change in `upsertInstruments`: the refresh sweep
**deactivates** rows instead of deleting them (D7, §4), so a curated row survives.

Neither requirement removes or changes any existing tool. The 24 scans encode domain
judgement about what "momentum" means in this dataset; a model writing raw SQL will
reinvent them worse while sounding confident. `nse_market_query` serves the long tail.

**Tool count goes 24 → 26.** `src/__tests__/tools.test.ts:6` asserts `toHaveLength(24)`
and must be bumped in the same commit.

### 1.1 Owner decisions

Five decisions from the 2026-08-06 review, each folded into the section that implements it.
They are recorded here so the reasoning survives even if a section is later rewritten.

| # | Decision | Where it lands |
|---|---|---|
| **D1** | **No synthetic instruments.** The tool registers only instruments that already exist upstream. It never invents an entry for a symbol with no real market data behind it. | §5.0 — the governing principle for `nse_instrument_add`, and the reason validation exists at all |
| **D2** | `backfill` is an **optional argument, default `false`**. When `true`, the tool backfills after registering. | §5.3 argument schema — first-class, not a footnote |
| **D3** | **Validate inside the tool when possible; when it cannot be validated, proceed rather than block.** Only a definitive "no such symbol" blocks registration; a network failure does not. | §5.2 |
| **D4** | **Do not make a second network call when one will do.** With `backfill: true` the backfill itself proves the symbol resolves, so the standalone validation call is skipped. **Interpretation — see §5.2.1, needs owner confirmation.** | §5.2.1, §5.4 |
| **D5** | **No new `indexes` table.** Indices stay as `instruments` rows with `instrument_type = 'index'`. | §2.2, §6.4 |
| **D6** | **No `source` column.** Dropped entirely. Upstream data wins over user-supplied values: if a field comes from Yahoo, Yahoo's value is used even when the user supplied one. The migration and every guard predicate that depended on it are removed. | §4, §5 — replaces the whole provenance mechanism |
| **D7** | **Soft delete, not hard delete.** `upsertInstruments`'s sweep sets `is_active = 0` instead of `DELETE`-ing, matching the existing `markInactive` pattern. `removed` in the return value now counts deactivations. | §4 |

D6 and D7 are one decision in two halves. D6 removes the provenance marker, so there is
nothing to key a "don't touch my row" guard on; D7 makes the destructive path
non-destructive for *every* row instead, which is what actually protects a curated
instrument. The cost of D6+D7 versus the original `source` design is stated plainly in §4.3:
a curated symbol absent from the shipped seed JSON is **deactivated** on the next
`refresh-instruments`. Its row and its price history survive — which is the whole point of
D7 — but it drops out of every scan until someone reactivates it.

D1 is the one that governs the rest. D3 and D4 are both mechanisms *for* D1 — they decide how
hard the tool tries to establish "this exists upstream", and how much network it spends doing
so. Read them in that order.

---

## 2. Verified current state — and six places the brief is wrong

Everything below was read from source or probed against the live DB at
`~/.ethos/market-data/market.db` (195 MB, 1371 instruments). The codebase is the authority.

### 2.1 `instruments` already has `industry`

The brief states "There is no `industry` column." That is true of
`SQL_CREATE_INSTRUMENTS` (`schema.ts:3–12`) and false of the effective schema.
`migrate()` at `schema.ts:501–506` already adds six columns:

```
industry         TEXT
market_cap_band  TEXT
instrument_type  TEXT NOT NULL DEFAULT 'equity'
index_category   TEXT
is_active        INTEGER NOT NULL DEFAULT 1
as_of_date       TEXT
```

The effective `instruments` shape is therefore twelve columns, and
`InstrumentSeedRow` (`schema.ts:514–526`) already types all of them.

**Consequence (superseded by D6): this change adds no columns at all.** The draft added one
(`source`); the owner dropped it. `instruments` stays at twelve columns and `schema.ts` is
not touched.

### 2.2 Indices already live in `instruments` — **decided (D5): no `indexes` table**

The brief states "an index has nowhere to carry its own name, provider or type" and
asks for a new `indexes` table. Both premises fail:

- `data/instruments.json` contains 20 rows with `instrument_type: 'index'` —
  `^NSEI`, `^CNXAUTO`, `^CRSLDX`, `^NSEBANK`, … each carrying `name`
  ("NIFTY Auto"), `exchange` ("NSE"), and `index_category`. Five category values are
  in use today: `broad`, `sector`, `cap_segment`, `regime`, `csv_curated`.
- `store.getActiveInstrumentsByType('index')` (`store.ts:944`) is the existing
  reader for exactly this.
- "Which indices do I track?" is already answerable without a `DISTINCT`:
  `SELECT symbol, name, index_category FROM instruments WHERE instrument_type='index' AND is_active=1`.

Mapping the brief's proposed `indexes` columns onto reality: `index_symbol` → `symbol`,
`name` → `name`, `type` → `index_category`, `added_at` → `added_at`, `provider` →
`exchange`. Every field has a home. A separate table would give two sources of truth for
an index's name and force every join in `store.ts` to decide which one to trust.

**Decision (D5): no `indexes` table.** Indices are registered as `instruments` rows
carrying `name`, `exchange` and `index_category`. The owner confirmed this independently
of the analysis above. §6.4 records that a separate table was considered; the DDL for it
has been removed rather than left standing as an alternative.

### 2.3 `store.runScan()` is already a generic SQL executor

The brief states "`src/store.ts` exports no generic query function." `MarketDataStore`
is exported from `src/index.ts`, and `runScan(sqlTemplate: string)` at `store.ts:909`
executes caller-supplied SQL on the **read-write** handle, gated only by
`/^select\s/i.test(trimmed)` — and when that test fails it interpolates the string into a
`WHERE` clause instead. It is reachable from the CLI (`cli.ts:410`) via saved-scan rows.

This matters twice over:

1. The precedent for "regex-gate a string and interpolate it" already exists here and
   is not a pattern to copy.
2. `runScan` is a pre-existing hole. Anything that can write a `saved_scans` row gets
   arbitrary SQL on a read-write connection. `nse_refresh_scans` loads from
   `scans/*.json` inside the package, so it is not currently model-reachable — but it
   is one tool away. **Out of scope for this spec; logged in §9 Q4.**

### 2.4 `upsertInstruments` deletes rows, it does not merely clobber them

`store.ts:819–829`, after the `INSERT OR REPLACE` loop:

```sql
DELETE FROM instruments WHERE symbol NOT IN (<every symbol in the incoming batch>)
```

So the failure mode the brief describes as "hand-entered sector/industry silently
evaporates" is worse than described: **the whole row is deleted.** A manually added
symbol disappears entirely on the next `refresh-instruments`, taking its `sync_meta`
association with it (no FK — `PRAGMA foreign_keys = ON` is set at `schema.ts:294` but
`instruments` has no dependents declared, so `ohlcv_daily` rows are orphaned, not
cascaded).

This is what makes a fix required before the add-instrument tool is usable at all. The fix
shipped is D7 — the sweep became
`UPDATE instruments SET is_active = 0 WHERE symbol NOT IN (…) AND is_active = 1`. See §4.

### 2.5 `schema_version` is created but never written

`SQL_CREATE_SCHEMA_VERSION` (`schema.ts:219`) is executed at `schema.ts:493`. Grep for
`schema_version` across `src/` returns exactly that one hit. There has never been an
`INSERT`, and `migrate()` has no version gate — it is a sequence of idempotent DDL
statements (`CREATE TABLE IF NOT EXISTS`, `addColumnIfNotExists`) that runs in full on
every `MarketDataStore` construction. See §4.3 for how this migration handles that.

### 2.6 The database is in `delete` journal mode, not WAL

`migrate()` runs `PRAGMA journal_mode = WAL` at `schema.ts:292`, and both
`CLAUDE.md` and `plan/tools-nse-market-data.md` §8 document WAL. The live DB reports:

```
PRAGMA journal_mode -> { journal_mode: 'delete' }
```

and `~/.ethos/market-data/` contains only `market.db` — no `-wal`, no `-shm`. The
node-sqlite3-wasm VFS has no shared-memory primitive, so the WAL request is silently
ignored.

This is *good news* for Requirement 1: the usual "a read-only connection to a WAL
database needs a writable `-shm`" hazard does not apply. A second `readOnly` connection
opens cleanly with no ordering constraint against the read-write handle. Verified below.

### 2.7 node-sqlite3-wasm 0.8.58 capability probe

Run against the live DB. These results drive every decision in §3.

| Probe | Result |
|---|---|
| `new Database(path, { readOnly: true })` | **opens** (d.ts line 45 confirms the option) |
| `INSERT` on that handle | **rejected** — `attempt to write a readonly database` |
| `PRAGMA query_only = 1` on that handle | accepted |
| `prepare('SELECT 1; DELETE FROM instruments')` | **returns `[{a:1}]`, no error** — compiles the first statement, silently discards the tail |
| `ATTACH DATABASE '<existing file>'` on the readOnly handle | **SUCCEEDS**, and the attached tables are readable |
| same, after `PRAGMA query_only = 1` | **still succeeds** — `query_only` does not block `ATTACH` |
| `PRAGMA database_list` via `prepare()` | succeeds, leaks the absolute DB path |
| `WITH d AS (DELETE … RETURNING *) SELECT * FROM d` | syntax error — SQLite has no DML-in-CTE (that is Postgres) |
| `load_extension()`, `readfile()` | `no such function` — not compiled into this build |
| `SELECT * FROM (<any select>) LIMIT ?` wrapping | works, **including** when the inner query is a `WITH …` CTE or already has its own `LIMIT` |
| `Statement.iterate()` + early `break` | works — rows can be consumed lazily and abandoned |
| Duplicate output column names (`SELECT i.symbol, w.symbol …`) | **silently collapse to one key** — rows are `Record<string, …>` |
| Column names when the result set is empty | **unrecoverable** — `all()` returns `[]` and there is no `columns()` API |
| Interrupt / statement-timeout API | **does not exist** — see §3.5 |

Two conclusions that change the design:

- The brief's worry about "a CTE wrapping a write" is a non-issue in SQLite, and
  multi-statement is not an *execution* risk (only a silent-truncation correctness risk).
- The brief does not mention `ATTACH`, which is the one real vector: a read-only
  connection will happily attach and read any other SQLite file on disk. It must be
  blocked explicitly.

Two corrections found while implementing (2026-08-07), neither of which changes the design:

- **`ATTACH` of the *same* file that the connection already has open fails with
  `database is locked`.** The original probe attached a different path. Attaching an
  unrelated `.db` still works, so `ATTACH` remains the vector and stays banned; the lock is
  incidental, not a defence.
- **A statement that is never `finalize()`d leaves a stale `<db>.lock` *directory* behind,
  and every later connection then fails with `database is locked` until it is removed by
  hand.** The wasm VFS has no shared memory (§2.6), so it locks with a directory. Every
  `prepare()` in `store.ts` must be paired with a `finalize()` — `query()` does it in a
  `finally`, including the early-`break` path out of `iterate()`. This is a footgun for
  throwaway scripts run against `~/.ethos/market-data/market.db`, not for the library.

---

## 3. Requirement 1 — `nse_market_query`

### 3.1 Decisions and reasoning

| Decision | Reasoning |
|---|---|
| Read-only is **structural**, via a separate `new Database(path, { readOnly: true })` handle | SQLite rejects writes at the engine, not at a string check we maintain. Reusing the read-write handle at `store.ts:336` would put every sync and backfill path one parser bug away from data loss. Verified: writes on the readOnly handle fail with `attempt to write a readonly database`. |
| `PRAGMA query_only = 1` on top | Costs one `exec()`. Defence in depth: if a future dependency bump changes `readOnly` semantics, this still holds. |
| **Tokenize**, don't regex the raw string | A raw regex over the query text is defeated by a string literal (`SELECT '; ATTACH …'`) or a comment. The tokenizer strips comments and quoted literals *first*, then inspects tokens. See §3.3. |
| Do **not** add a SQL grammar dependency | SQLite is already the parser, and the connection is already read-only, so a full grammar buys nothing on the write axis. The tokenizer exists for two jobs `readOnly` cannot do: block `ATTACH`, and reject multi-statement input that `prepare()` would otherwise truncate in silence. A ~1 MB parser for that is not a trade worth making in a package that already ships a compressed seed DB. |
| Wrap for `LIMIT`, don't append | `SELECT * FROM (<user sql>) LIMIT ?` composes with an inner `ORDER BY`, an inner `LIMIT`, and a leading `WITH`. All three verified. Appending ` LIMIT n` breaks on `… LIMIT 500` and on compound `UNION` queries. |
| **Also** cap rows via `iterate()` | Belt and braces. If the wrap is ever bypassed, `iterate()` + `break` means we never materialize an unbounded result into JS heap. |
| Return JSON | The other 24 tools emit space-padded text tables formatted for a human at a terminal. A model doing follow-up analysis parses JSON more reliably, and padded columns burn tokens on whitespace. |
| Inline the schema in `description` | The schema is small and fixed. A separate `nse_describe_schema` tool costs a round-trip on every query, and the model will sometimes skip it and hallucinate columns anyway. Paying the tokens once per turn beats being wrong. |
| Own toolset: `market_query` | All 24 existing tools are `toolset: 'market'` (verified: 24/24). A personality can then hold the curated scans without holding arbitrary SQL. |
| `requiresApproval: false` | It cannot write. Gating a read behind approval trains the user to approve reflexively, which devalues the gate on `nse_market_clean` and `nse_market_backfill`, where it matters. |

### 3.2 Read-only connection

`MarketDataStore`'s constructor calls `migrate()` and `seedBuiltinScans()`
(`store.ts:337–338`), both of which write. The read-only handle therefore cannot be a
second `MarketDataStore`. Add a method that lazily opens and caches a raw handle:

```typescript
// store.ts — inside MarketDataStore

private roDb: DatabaseType | null = null;
private readonly dbPath: string;   // capture in the constructor

/** Lazily-opened read-only handle. Never used by any write path. */
private readOnlyDb(): DatabaseType {
  if (this.roDb === null) {
    this.roDb = new Database(this.dbPath, { readOnly: true });
    this.roDb.exec('PRAGMA query_only = 1');
  }
  return this.roDb;
}

close(): void {
  if (this.roDb !== null) {
    this.roDb.close();
    this.roDb = null;
  }
  this.db.close();
}
```

`:memory:` note — a second `Database(':memory:', { readOnly: true })` is a *different*,
empty database, so `query()` cannot see test fixtures written through `this.db`. Store
tests that exercise `query()` must use a temp file path. This is the one place the
project's "always use `:memory:`" convention (CLAUDE.md, Testing) does not apply; call it
out in the test file.

### 3.3 Statement admission — the tokenizer

New file `src/sql-guard.ts`. Pure, no DB, no network — same shape as `patterns.ts`.

```typescript
export interface GuardOk    { ok: true }
export interface GuardFail  { ok: false; reason: string }
export type GuardResult = GuardOk | GuardFail;

const BANNED = new Set([
  'attach', 'detach', 'pragma', 'vacuum', 'begin', 'commit', 'rollback',
  'insert', 'update', 'delete', 'replace', 'create', 'drop', 'alter', 'reindex',
]);

/**
 * Strip comments and quoted literals, then admit only a single SELECT/WITH.
 *
 * The engine already refuses writes (readOnly connection + query_only). This
 * guard covers the two things the engine does not:
 *   - ATTACH, which a readOnly connection permits and which reads arbitrary
 *     SQLite files off disk;
 *   - trailing statements, which prepare() discards silently rather than
 *     rejecting, so `SELECT 1; DROP …` would appear to succeed.
 * The DML keywords are redundant with the engine but produce a clear error
 * instead of a driver-level one.
 */
export function guardSelect(sql: string): GuardResult;
```

Tokenizer rules, in order:

1. Reject empty / whitespace-only input.
2. Scan the string once, character by character, tracking state:
   - `'…'` single-quoted string, `''` is an escaped quote
   - `"…"` and `` `…` `` and `[…]` identifier quoting
   - `-- …` to end of line
   - `/* … */` block comment (SQLite does not nest these)
   Emit a *scrubbed* copy where every literal, identifier body, and comment is
   replaced by a single space. All later checks read the scrubbed copy only.
3. Reject any `;` in the scrubbed copy that is followed by non-whitespace. A single
   trailing `;` is tolerated and stripped.
4. Lowercase, split on `/[^a-z_]+/`. The first token must be `select` or `with`.
5. Reject if any token is in `BANNED`. `with` is not banned; a `WITH` CTE whose body
   is a `SELECT` is legitimate and useful.
6. Reject if the scrubbed input exceeds 8 000 characters — a query that long is a
   pasted mistake, and every branch of it costs runtime we cannot interrupt (§3.5).

Why keyword-set rejection is safe against false positives here: step 2 has already
removed identifiers and literals, so a column literally named `update` (there is none;
verified against all 14 tables) or a string containing the word `delete` cannot trip it.
The residual false-positive surface is an *unquoted* identifier equal to a banned
keyword, which SQLite would itself reject as a syntax error.

Explicitly **not** blocked, with reasons:

- `WITH` — needed, and DML-in-CTE is a syntax error in SQLite (§2.7).
- `UNION` / `EXCEPT` / `INTERSECT` — read-only compound selects, legitimate.
- `sqlite_master` — readable and useful for the model to self-check column names;
  it leaks nothing the inlined schema in the description does not already state.

### 3.4 Output bounding

Three independent caps, because each fails differently:

| Cap | Value | Enforced where | Failure it prevents |
|---|---|---|---|
| Row limit | `args.limit ?? 200`, clamped to `[1, 1000]` | `SELECT * FROM (<sql>) LIMIT ?` | Runaway join floods context |
| Iteration cap | same number | `for (const row of stmt.iterate())` with `break` | Heap blowup if the wrap is ever bypassed |
| Byte budget | 30 000 chars of accumulated JSON | inside the iterate loop | A 200-row result of long TEXT columns still overflowing |

`maxResultChars: 40000` on the tool gives the registry a final post-trim. The byte budget is
deliberately **smaller** than `maxResultChars` so that *our* truncation note, not the
registry's opaque `[truncated]` marker, is what the model sees. (An earlier draft said
200 000 chars "so our message lands first" — that reasoning was backwards: a budget above
`maxResultChars` guarantees the registry truncates first and eats our note.)

Verified against the real 195 MB DB: `SELECT * FROM ohlcv_daily` with `limit: 1000` returns
122 rows and a 30 369-char payload, flagged `truncated: true` with the byte-budget note.

### 3.5 The timeout problem — no interrupt API exists

The brief asks for a statement timeout. **node-sqlite3-wasm 0.8.58 cannot provide one.**
The type surface is `close / function / exec / prepare / run / all / get` on `Database`
and `run / iterate / all / get / finalize` on `Statement`. There is no `interrupt()`, no
progress handler, no busy callback that fires mid-scan. `PRAGMA busy_timeout = 5000`
(`schema.ts:293`) is a *lock-wait* timeout and has nothing to do with statement runtime.

The module is also synchronous, so a slow query blocks the Node event loop for its whole
duration — it does not merely delay this tool, it stalls the agent.

Two honest options:

**(a) Worker-thread isolation.** Run the query in a `node:worker_threads` worker that
opens its own read-only handle; the main thread races it against a timer and calls
`worker.terminate()` on expiry. This is the only mechanism that actually bounds runtime,
and it also gets the synchronous WASM work off the main loop. Cost: WASM instantiation
per query (tens of ms), plus re-opening the DB, plus a second code path for `:memory:`
in tests.

**(b) Ship without a timeout**, relying on the structural bounds in §3.4 plus the
tokenizer's length cap, and document the gap.

**Recommendation: (b) in Phase 1, (a) in Phase 2.** Rationale: the bounded caps make the
*output* safe immediately, which is the failure the brief actually describes ("flood the
model's context"). The unbounded-runtime failure ("hang the process") needs (a), but a
cartesian product over `ohlcv_daily` is a plausible-enough model mistake that (a) should
not be deferred indefinitely. Do not ship (b) as final. Logged as §9 Q1.

### 3.6 Tool definition

```typescript
interface MarketQueryArgs {
  sql: string;
  limit?: number;
}

const nseMarketQueryTool: Tool<MarketQueryArgs> = {
  name: 'nse_market_query',
  description: MARKET_QUERY_DESCRIPTION,   // §3.7
  toolset: 'market_query',
  capabilities: {},
  maxResultChars: 40000,
  cache: { ttlMs: 60_000 },
  schema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description:
          'A single read-only SELECT (or WITH … SELECT). No semicolons, no PRAGMA, ' +
          'no ATTACH, no writes. Alias every output column — duplicate names collapse.',
      },
      limit: {
        type: 'number',
        description: 'Max rows to return (default 200, max 1000).',
      },
    },
    required: ['sql'],
  },
  async execute(args, _ctx): Promise<ToolResult> { /* … */ },
};
```

Store method:

```typescript
query(sql: string, limit: number): {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  elapsedMs: number;
};
```

`query()` calls `guardSelect()` and throws a typed error on failure; the tool translates
that into `{ ok: false, code: 'input_invalid' }`.

### 3.7 The inlined schema description

`MARKET_QUERY_DESCRIPTION` is a module constant in `tools.ts`. It must state, at minimum:

- One sentence of purpose, and the instruction to prefer `nse_run_scan` /
  `nse_market_screen` when a curated scan already answers the question.
- Table list with column names. All 14 tables come from `schema.ts`; `indicators_daily`
  has 88 columns and `market_state_daily` 39, which is the bulk of the text. Group them
  by the comment headings already present in `SQL_CREATE_INDICATORS_DAILY`
  (Trend / Momentum / Relative Strength / Volatility / Volume / VWAP / Price Levels /
  Candle / Multi-Timeframe / Stage / Sniper / Composite / Setup / Chart Patterns) rather
  than listing 88 names flat — the grouping is what lets the model pick the right one.
- The three join keys that matter: `ohlcv_daily` and `indicators_daily` both key on
  `(symbol, date)`; `instruments.symbol` is the join target for both;
  `index_constituents(index_symbol, member_symbol)` maps an index to members.
- The two universe filters every existing scan applies:
  `instruments.instrument_type = 'equity' AND instruments.is_active = 1`.
- "Latest date" idiom: `WHERE date = (SELECT MAX(date) FROM indicators_daily)`.
- The duplicate-column-name footgun (§2.7) and the instruction to alias.

Budget it at roughly 1 200–1 600 tokens. If it grows past that, drop the
`market_state_daily` / `sector_state_daily` column lists to their group names and let the
model `SELECT sql FROM sqlite_master WHERE name='market_state_daily'` for detail —
that is the one lookup worth a round-trip, because those two tables are rarely queried.

Keeping this constant in sync with `schema.ts` by hand will rot. Add a test that reads
`PRAGMA table_info` for each table from a fresh in-memory DB and asserts every column
name appears in `MARKET_QUERY_DESCRIPTION`. It fails the day someone adds a column and
forgets the description. See §7.

### 3.8 Response shape

Success — `value` is a JSON string:

```json
{
  "row_count": 3,
  "truncated": false,
  "elapsed_ms": 41,
  "columns": ["symbol", "close", "rsi_14"],
  "rows": [
    { "symbol": "RELIANCE.NS", "close": 1402.5, "rsi_14": 61.2 },
    { "symbol": "TCS.NS",      "close": 3980.1, "rsi_14": 48.7 },
    { "symbol": "INFY.NS",     "close": 1611.0, "rsi_14": 55.4 }
  ]
}
```

- `columns` is derived from `Object.keys(rows[0])`. **On an empty result set it is `[]`**
  — node-sqlite3-wasm exposes no column metadata API, and `all()` on a zero-row query
  returns `[]` (verified §2.7). Document this in the description so the model does not
  read `"columns": []` as "the table has no columns".
- `truncated: true` means either the row cap or the byte budget bit. When it is true,
  append a `"note"` field naming which one and suggesting a narrower `WHERE` or an
  explicit `ORDER BY` — an unordered truncated result is a silently arbitrary sample,
  and the model should be told so.
- `elapsed_ms` is wall time around `prepare`+iterate. It is the only runtime signal the
  model gets while §3.5(a) is unimplemented.

### 3.9 Failure modes

| Condition | `code` | `error` |
|---|---|---|
| Empty / whitespace `sql` | `input_invalid` | `sql is required.` |
| First token is not `select` / `with` | `input_invalid` | `Only SELECT queries are allowed. Statement begins with '<token>'.` |
| Trailing statement after `;` | `input_invalid` | `Only one statement per call. Remove everything after the first ';'.` |
| Banned keyword token | `input_invalid` | `'<kw>' is not allowed in nse_market_query. This tool is read-only.` |
| `sql` longer than 8 000 chars | `input_invalid` | `Query too long (<n> chars, max 8000).` |
| SQLite syntax error / unknown column | `execution_failed` | `Query failed: <sqlite message>` — pass the engine message through verbatim; `no such column: rsi14` is exactly the correction signal the model needs. |
| `limit` outside `[1, 1000]` | *not an error* | clamp silently; a model guessing `limit: 100000` should get 1000 rows, not a round-trip. |
| DB file missing | `not_available` | `Market database not found at <path>. Run nse-market-data backfill --all first.` |
| Write attempt that slips past the guard | `execution_failed` | driver message `attempt to write a readonly database` — should be unreachable; if this ever appears in logs, the tokenizer has a hole. |

---

## 4. Requirement 2 — the soft delete (D6, D7)

### 4.1 What changes

**No schema change.** The draft added `instruments.source TEXT NOT NULL DEFAULT 'sync'` as a
provenance marker so the sync path could refuse to touch curated rows. D6 dropped it:
upstream data wins over user-supplied values, so a curated row has no claim to protection
from an *overwrite*. `schema.ts` is untouched by this change.

**One behaviour change**, in `upsertInstruments` (`store.ts`). The sweep that ran after the
insert loop:

```sql
DELETE FROM instruments WHERE symbol NOT IN (<every symbol in the incoming batch>)
```

became

```sql
UPDATE instruments SET is_active = 0
 WHERE symbol NOT IN (<every symbol in the incoming batch>)
   AND is_active = 1
```

`is_active` already exists (§2.1) and three read paths already filter on `is_active = 1`
(`store.ts:521`, `:530`, `:543`), so nothing downstream needs teaching. The `AND is_active = 1`
clause is not decoration: without it, `changes` re-counts every already-inactive row on every
refresh and `removed` inflates forever.

The return shape is unchanged — `{ upserted, removed }` — so all three callers
(`cli.ts:488`, `cli.ts:588`, `tools.ts:194`) keep working with no edit. `removed` now counts
deactivations rather than deletions; the two CLI sites print it as "removed", which is now
imprecise but not wrong enough to justify changing user-visible output in this commit.

### 4.2 Why this and not the `source` guard

The batch passed to `upsertInstruments` is always the shipped `data/instruments.json`, so a
manually added symbol is never in it. Under the old sweep the row was **deleted** on the next
`refresh-instruments` (`cli.ts:488`), `init` (`cli.ts:588`), or auto-seed inside
`nse_market_backfill` (`tools.ts:194`) — not overwritten, not merged. Deleted, and its
`ohlcv_daily` history orphaned, because the schema declares no foreign keys.

`source = 'manual'` would have exempted curated rows from both the overwrite and the sweep.
D6 rejects the exemption: Yahoo's value for a field wins over the user's. What is left worth
keeping is the *row*, and D7 keeps it — at the cost stated in §4.3.

### 4.3 What a curated row still loses

A curated symbol absent from the shipped seed JSON is **deactivated** by the next refresh:
`is_active` flips to 0, and every scan filters it out. The row and its price history survive
— that is the difference from a `DELETE`, and it is what makes the data recoverable — but the
instrument stops appearing in results until someone sets `is_active = 1` again.

This is a real consequence of D6, not an oversight. Recording it because the "durability"
language elsewhere in this spec was written against the `source` design and no longer holds:
a curated row is now *durable*, not *immune*.

Two ways to close the gap later, neither in scope here: add the curated symbols to
`data/instruments.json` (they then appear in every batch), or re-introduce a provenance
marker used *only* by the sweep and not by the overwrite — which is D6-compatible, since D6
is about field values, not about row lifecycle.

### 4.4 `markInactive` and the seed path

`markInactive()` (`store.ts:781`) is unchanged. It already sets `is_active = 0` for the
symbols it is given, which is exactly the semantics D7 gives the sweep, and with no `source`
column there is nothing to exempt.

`seed.ts:170` (`cli seed-update`) inserts with `INSERT OR IGNORE` and an explicit column list,
so it never touches an existing row and needs no change.

### 4.5 Effect on the pre-built seeded database

None. There is no DDL, so `postinstall.ts` and `data/seed.db.gz` are unaffected, an older DB
opened by newer code behaves identically, and there is no migration to record — which is what
closes Q3 (§9): with no schema change, writing the first `schema_version` row would be
recording a migration that does not exist.

## 5. `nse_instrument_add`

### 5.0 Governing principle (D1) — no synthetic instruments

**The tool registers only instruments that already exist upstream. It never invents an entry
for a symbol that has no real market data behind it.**

Everything else in this section follows from that sentence, and it is the reason validation
exists at all. A row in `instruments` is a claim that the symbol is real and that the feed
will serve data for it. `backfillAll` acts on that claim, `nse_run_scan` and
`nse_market_screen` read the universe built from it, and the soft delete in §4 makes the
claim **durable** — a curated row is no longer destroyed by a refresh sweep. That durability
is exactly what makes an unvalidated row expensive: before D7, a typo was cleaned up by the
next `refresh-instruments`; after it, the typo's row persists (deactivated) until a human
deletes it.

So the soft delete and the validation are two halves of one decision. Making rows survive the
sync path is only safe if the tool refuses to create rows that are not backed by real
upstream data.

Two consequences worth stating plainly, because they set the boundaries of D3 and D4:

- **"Exists upstream" means "the price feed resolves this symbol."** Not "NSE lists it" —
  see §5.2. The feed is the thing that determines whether the row will ever receive data.
- **D1 is not a demand for certainty.** The tool establishes upstream existence when it can
  and proceeds when it cannot (D3). What it must never do is register a symbol it has
  positively established does *not* exist. Absence of proof is not proof of absence, and
  blocking on the former would make the tool unusable offline and on fresh listings.

### 5.1 Decisions

| Decision | Reasoning |
|---|---|
| Existing symbol → **report and show current values**, do not insert, do not error, do not upsert | `symbol` is `PRIMARY KEY`, so a blind insert throws anyway. The point is that the model asked "is this tracked?" in the only way it can, and the useful answer is the row, not `SQLITE_CONSTRAINT`. |
| Mutating an existing row requires `update: true` | Makes overwriting curated data an explicit act. A model retrying a failed call must not silently clobber. |
| Registering does **not** fetch history by default | An instrument with no `ohlcv_daily` rows is invisible to every scan (`nse_run_scan` joins `indicators_daily`; `screen()` calls `getHistory()` and `continue`s on empty). The response must say so and name the next step. |
| **(D2)** `backfill` is an optional argument, **default `false`**; when `true` the tool backfills after registering | A metadata tool should not quietly become a multi-minute network operation. Confirmed by the owner and specified in the argument schema at §5.3 — it is a declared argument with a declared default, not a footnote. |
| **(D3)** Validate the symbol **when possible**; proceed when it cannot be validated | Serves D1 without making the tool hostage to feed availability. Only a definitive "no such symbol" blocks. See §5.2. |
| **(D4)** Do not spend a second network call when one will do — with `backfill: true`, derive the verdict from the backfill | The backfill hits the same endpoint with the same symbol string, so it already answers the validation question. See §5.2.1. |
| Validate via `fetchQuote()` from `fetcher.ts`, **not** `nse-fetcher.ts` | See §5.2. |

### 5.2 Symbol validation (D3) — `fetchQuote`, and only a definitive miss blocks

The brief says "Check what `src/nse-fetcher.ts` already offers for this." `nse-fetcher.ts`
exports `fetchFiiDii`, `fetchCorporateActions`, `fetchBulkBlockDeals`, `fetchGiftNifty`
and their row types. **None of them validate a symbol** — there is no validation surface in
that module at all, and no NSE symbol-lookup endpoint is wired anywhere in the package.

What exists, in `fetcher.ts`:

- `fetchQuote(symbol)` (`fetcher.ts:182`) — hits the Yahoo chart endpoint for that exact
  symbol and returns `{ symbol, price, currency, name }`.
- `searchSymbol(query)` (`fetcher.ts:205`) — fuzzy Yahoo search, returns up to 10 candidates.

**Use `fetchQuote`.** It answers the question D1 actually asks — *will this symbol receive
data from the feed we backfill from* — and it answers it through the identical code path.
Verified: `fetchQuote` (`fetcher.ts:182`) and `fetchOhlcv` (`fetcher.ts:119`, which is what
`backfillSymbol` at `store.ts:399` calls) both delegate to the same helper
`fetchChartResponse` (`fetcher.ts:92`) against the same
`query1.finance.yahoo.com/v8/finance/chart/<symbol>` URL. They differ only in the query
string — `range=1d` versus a `period1`/`period2` window. Symbol resolution is therefore
byte-for-byte the same operation, which is what makes `fetchQuote` a truthful proxy for
"will the backfill find this" and what makes D4 (§5.2.1) sound.

`searchSymbol` is *not* the validator: it is fuzzy and would accept a near-miss that then
fails every sync. It earns one job — when validation definitively fails, call it once and
put the top three candidates in the error message. `"RELIANC.NS not found — did you mean
RELIANCE.NS?"` turns a dead end into a one-turn fix.

`fetchQuote` has two bonuses that the backfill path does not: it returns `name`, so the tool
can auto-fill `name` when the caller omits it, and `currency` gives a cheap wrong-exchange
check (`INR` expected). This matters in §5.2.1.

Validation is therefore **against Yahoo Finance, not NSE**, which contradicts the brief's
wording. That is the right trade: NSE is the market, Yahoo is the data source, and a symbol
that NSE recognises but Yahoo does not is still a dead row under D1.

#### Definitive miss vs. transient failure — the distinction that decides whether to block

D3's rule: **only a definitive "this symbol does not exist" blocks registration. Every other
validation failure proceeds.** The difference is "Yahoo is down" versus "this symbol does not
exist", and the tool must not confuse the two — treating an outage as a bad symbol would make
`nse_instrument_add` unusable whenever the feed is unavailable, which is precisely the
"cannot be validated → ignore" case the owner ruled on.

The distinction is implementable because `fetchChartResponse` (`fetcher.ts:92–110`) already
throws distinguishable errors:

| Thrown by | Message | Verdict |
|---|---|---|
| HTTP 404 (`fetcher.ts:95–97`) | `Symbol not found: <symbol>` | **Definitive miss — block** |
| Yahoo's own error object (`fetcher.ts:105–107`) | `chart.error.description` | **Definitive** when the code is a not-found class; otherwise treat as transient |
| 200 with null/empty `chart.result` (`fetcher.ts:108–110`) | `No data returned for symbol: <symbol>` | Ambiguous — **proceed**, and say so |
| Any other non-ok status (`fetcher.ts:98–100`) | `Yahoo Finance error: <status>` | Transient — **proceed** |
| Retry exhaustion (`fetchWithRetry`, `fetcher.ts:29`) | `Yahoo Finance rate limit after N attempts` | Transient — **proceed** |
| `fetch` rejection / `AbortSignal.timeout(30_000)` (`fetcher.ts:23`) | `TypeError` / `DOMException`, no message contract | Transient — **proceed** |

Implementation note: classify by matching the two definitive messages, and default the
`else` branch to *proceed*. Do not build the predicate the other way round — an
unrecognised error must fall into "could not validate", not into "does not exist", because a
new failure mode added to `fetcher.ts` later would otherwise start silently blocking
registrations. `isYahooRateLimited()` (`fetcher.ts:227`) already classifies the rate-limit
family and can be reused for the message the response prints, but it is not the gate; the
gate is "did we positively establish absence".

When validation is skipped for a transient reason, the row is still written and the response
**must** say the symbol was not confirmed and name the consequence — that if the symbol is wrong, the backfill will find nothing and the row will
sit inert. An unconfirmed row is a normal outcome, not an error: `ok: true`.

Escape hatch: `validate: false` skips the call entirely, for offline use and for symbols
Yahoo lags on (fresh IPOs). Same reporting requirement.

#### 5.2.1 One network call, not two (D4) — **interpretation, please confirm**

> **This section is an interpretation of the owner's note *"Let's not send second in symbol
> if it is not needed"* and should be confirmed before implementation.** It is read here as:
> *when `backfill: true`, the backfill request already proves the symbol resolves, so do not
> also make a standalone validation call — derive the verdict from the backfill result.*
> If the owner meant something else by "second in symbol" — a symbol *suffix* (the `.NS` /
> `.BO` second segment), or a second symbol *field* on the arguments — then this section and
> the ordering in §5.4 need revisiting, and the rest of D3 stands unchanged either way.

Under the interpretation above:

- **`backfill: false` (or omitted)** — one standalone `fetchQuote(symbol)` call, per §5.2.
- **`backfill: true`** — no standalone `fetchQuote`. The backfill *is* the validation, and
  the verdict comes from how it fails. `backfillSymbol` → `fetchOhlcv` → `fetchChartResponse`
  throws the exact same `Symbol not found: <symbol>` on a 404 that `fetchQuote` would, so the
  definitive/transient table above applies unchanged to the backfill's error.

Three consequences that the implementation must handle, all verified against source:

1. **Order flips when `backfill: true`.** §5.4's "validate before touching the DB" property
   would otherwise be lost: with no standalone validation, a typo'd symbol would be inserted
   first and only discovered when the backfill failed — and thanks to the §4.5 guard that bad
   row is now protected from the refresh sweep, so it would be *permanent*. So when
   `backfill: true`, **run the backfill first, then register.** This is safe: there are zero
   `FOREIGN KEY` / `REFERENCES` clauses anywhere in `schema.ts` (verified by grep, despite
   `PRAGMA foreign_keys = ON` at `schema.ts:294`), so writing `ohlcv_daily` and `sync_meta`
   rows for a symbol not yet present in `instruments` is legal. And on a definitive miss
   nothing is written at all — `fetchOhlcv` throws inside `fetchChartResponse`, before
   `insertOhlcv` is ever reached (`store.ts:401–402`).

2. **Zero rows is not a validation failure.** `fetchOhlcv` returns `[]` on a *successful*
   chart response when `timestamp` is absent, the quote array is empty, or every candle is
   filtered out for null values (`fetcher.ts:135–160`). `backfillSymbol` passes that straight
   through as `rowsInserted: 0` (`store.ts:409`). That means the symbol resolved and simply
   has no usable candles in the requested window — a fresh listing, a suspended scrip, or too
   narrow a `backfill_days`. **Register the row and report "0 rows".** Reading 0 rows as "no
   such symbol" would reject exactly the fresh-IPO case D3's escape hatch exists to serve.

3. **The backfill path cannot auto-fill `name`.** `fetchOhlcv` returns `OhlcvRow[]` — no
   `name`, no `currency`. `fetchQuote` returns both. So when `backfill: true` **and** `name`
   is omitted, one `fetchQuote` call is still required, because `instruments.name` is
   `NOT NULL` and there is nothing else to populate it from. This is consistent with D4 as
   worded — the second call is *needed* in that case, so the "if it is not needed" condition
   does not apply. When `name` **is** supplied, no `fetchQuote` call is made at all.

Net effect on call count, which is what D4 is optimising:

| `backfill` | `name` supplied | `fetchQuote` calls | Backfill calls |
|---|---|---|---|
| `false` / omitted | either | 1 | 0 |
| `true` | yes | **0** | 1 |
| `true` | no | 1 (for `name`) | 1 |

### 5.3 Tool definition

```typescript
interface InstrumentAddArgs {
  symbol: string;                       // required, e.g. 'ZOMATO.NS'
  name?: string;                        // auto-filled from fetchQuote when omitted
  exchange?: string;                    // default 'NSE'
  sector?: string;
  industry?: string;
  isin?: string;
  market_cap_band?: string;
  instrument_type?: 'equity' | 'index'; // default 'equity'
  index_category?: string;
  members?: Array<{ symbol: string; weight?: number }>;  // index only — see §6
  as_of_date?: string;                  // YYYY-MM-DD stamped on member rows, default today (IST)
  validate?: boolean;                   // default true
  update?: boolean;                     // default false
  backfill?: boolean;                   // default false  (D2)
  backfill_days?: number;               // default 365, only read when backfill: true
}

const nseInstrumentAddTool: Tool<InstrumentAddArgs> = {
  name: 'nse_instrument_add',
  description:
    'Register an NSE instrument that already exists on the price feed. Confirms the ' +
    'symbol against the feed before registering; a symbol the feed positively rejects ' +
    'is refused. Does NOT download price history unless backfill is true — without it ' +
    'the instrument stays invisible to every scan. Idempotent: an existing symbol is ' +
    'reported, not overwritten.',
  toolset: 'market',
  capabilities: { network: { allowedHosts: ['query1.finance.yahoo.com'] } },
  maxResultChars: 4000,
  requiresApproval: false,
  schema: {
    type: 'object',
    properties: {
      // … symbol, name, exchange, sector, industry, isin, market_cap_band,
      //   instrument_type, index_category, validate, update …

      backfill: {
        type: 'boolean',
        description:
          'Download price history immediately after registering. Default false. ' +
          'When false the instrument is registered but invisible to nse_run_scan, ' +
          'nse_market_screen and nse_market_indicators until you run ' +
          'nse_market_backfill and nse_compute_indicators.',
      },
      backfill_days: {
        type: 'number',
        description:
          'How many days of history to download. Default 365. Ignored when backfill is false.',
      },
    },
    required: ['symbol'],
  },
  async execute(args, ctx): Promise<ToolResult> { /* … */ },
};
```

`backfill` is a declared argument with a declared default of `false` (D2) — the default lives
in the schema description the model reads, not only in the implementation. `backfill_days`
is read only when `backfill` is `true`; passing it alone is not an error, it is inert.

`toolset: 'market'`, not `market_query` — it is a curation tool, not a SQL surface, and a
personality that has the scans should be able to add a symbol.

`requiresApproval: false`: it writes one metadata row and cannot delete anything. If `backfill: true` is passed, the network cost is
proportional to one symbol — `nse_market_backfill`'s `requiresApproval: true`
(`tools.ts:136`) exists because it can span ~2 900 symbols.

New store method:

```typescript
addInstrument(row: InstrumentSeedRow, opts: { update?: boolean }): {
  status: 'created' | 'updated' | 'exists';
  existing: InstrumentRow | null;   // populated for 'exists' and 'updated'
};
```

Two supporting readers ship with it: `getInstrument(symbol)` (the row, or `null`) and
`getSymbolCoverage(symbol)` (`{ rows, firstDate, lastDate }` over `ohlcv_daily`), which is
what lets the `exists` response distinguish "registered" from "has data".

`addInstrument` is an `INSERT … ON CONFLICT(symbol) DO UPDATE`, not `INSERT OR REPLACE`, and
`added_at` is carried over from the existing row on an update — the old `INSERT OR REPLACE`
reset it on every write, which made the column meaningless.

### 5.4 Behaviour and response

Order of operations — **the upstream check always precedes the write**, so a symbol the feed
positively rejects never lands (D1). Which call performs that check depends on `backfill`
(D4).

Common prefix:

1. Normalise `symbol` (trim, uppercase). Reject if it does not match `/^\^?[A-Z0-9&\-]+(\.[A-Z]{2})?$/`.
   Warn — do not reject — when it has no `.NS` / `.BO` suffix and is not `^`-prefixed;
   `symbols.ts` and every existing row use the suffixed form.
2. `SELECT * FROM instruments WHERE symbol = ?`. If found and `update !== true`, return
   the `exists` response and stop. **No network call** — an idempotent re-add costs nothing.

Then, when `validate === false`, skip to the write. Otherwise branch on `backfill`:

**Path A — `backfill` false or omitted (one `fetchQuote`):**

3a. `fetchQuote(symbol)`.
4a. Classify per §5.2. Definitive miss → `searchSymbol` for suggestions, return
    `not_available`, **write nothing**. Transient failure → continue, flagging the row as
    unconfirmed. Success → adopt `name` and `currency`.
5a. Insert (or update, when `update: true`).

**Path B — `backfill: true` (no standalone validation call):**

3b. If `name` was omitted, `fetchQuote(symbol)` for it (§5.2.1 consequence 3); otherwise no
    call here.
4b. `store.backfillSymbol(symbol, fromDate)` — **before** the insert. This both fetches the
    history and settles the validation question.
5b. If it threw: classify the error per §5.2. Definitive miss → `searchSymbol`, return
    `not_available`, **write nothing** (nothing was written — `fetchOhlcv` throws before
    `insertOhlcv`). Transient → continue to the insert, flagging the row as unconfirmed and
    the backfill as failed.
6b. Insert (or update). `rowsInserted: 0` is a success with a caveat, not a failure
    (§5.2.1 consequence 2).

Why Path B writes the history before the instrument row: the soft delete in §4 makes a
curated row survive every refresh sweep, so a bad row created before validation would persist
until a human deleted it. Backfilling first keeps the "nothing lands unless upstream confirms it"
property that Path A gets for free. There are no foreign keys in the schema, so the
temporarily orphaned `ohlcv_daily` / `sync_meta` rows are legal — and on the failure path
they are never created.

Created (Path A, confirmed):

```
Registered ZOMATO.NS (Zomato Limited) — sector: Retail trade.
Confirmed on the price feed: ₹274.30 INR.

No price history yet. This symbol is invisible to nse_run_scan, nse_market_screen and
nse_market_indicators until you run:
  nse_market_backfill  symbols: "ZOMATO.NS", days: 1825
then:
  nse_compute_indicators
```

Already exists (`update` not set):

```
ZOMATO.NS is already registered. Current values:
  name             Zomato Limited
  exchange         NSE
  sector           Retail trade
  industry         Internet software/services
  isin             INE758T01015
  instrument_type  equity
  is_active        1
  price history    1,247 rows, 2021-07-23 → 2026-08-05

Nothing was changed. Pass update: true to overwrite these values.
```

Including the OHLCV row count and date range is worth the extra query: "already
registered" and "already has data" are different states, and the model needs the second
one to decide whether to backfill.

With `backfill: true` (Path B), replace the "No price history yet" block with
`Backfilled 1,247 rows (2021-07-23 → 2026-08-05). Symbol confirmed by the backfill itself.
Run nse_compute_indicators to make it scannable.` — indicators are a separate step
(`nse_compute_indicators`, `tools.ts:872`) and the response must not imply otherwise.

With `backfill: true` and zero rows returned, say so without implying the symbol is bad:
`Backfilled 0 rows — the symbol resolves on the feed but has no candles in the last 365
days. It may be newly listed or suspended. Try a longer backfill_days.`

With `validate: false`, prepend `Not checked against the price feed (validate: false). If
the symbol is wrong, every sync for it will fail silently and this row will sit inert.`

When validation was attempted but could not be completed (transient failure, D3), prepend
`Could not confirm ZOMATO.NS against the price feed — <reason>. Registered anyway. If the
symbol is wrong, the next backfill will return nothing.` The row is still created and the
result is still `ok: true`; the caveat is informational, not an error.

### 5.5 Failure modes

| Condition | `code` | Behaviour |
|---|---|---|
| `symbol` missing/empty | `input_invalid` | reject |
| `symbol` fails the character pattern | `input_invalid` | reject, show the expected form |
| Exists, `update` not set | **`ok: true`** | the `exists` response above — this is not an error |
| Exists, `update: true` | `ok: true` | overwrite, `status: 'updated'`, echo old → new |
| **Definitive miss** — feed positively rejects the symbol (404 → `Symbol not found:`) | `not_available` | **Block.** `'<sym>' not found on the price feed. Did you mean: …? Pass validate: false to add it anyway.` Nothing is written. This is the only validation outcome that blocks (D1, D3). |
| **Transient failure** — timeout, 429, 5xx, unclassified error | **`ok: true`** | **Proceed.** Register the row, prepend the "could not confirm" caveat from §5.4, name the reason (`isYahooRateLimited()` at `fetcher.ts:227` supplies the wording for the rate-limit family). This reverses the earlier draft, which refused to insert on a network failure — D3 rules that "Yahoo is down" must not read as "this symbol does not exist". |
| Ambiguous — 200 with empty `chart.result` | **`ok: true`** | Proceed with the caveat. Cannot distinguish a delisted symbol from a feed hiccup, and D3 says do not block on what cannot be established. |
| `name` omitted and validation skipped via `validate: false` | `input_invalid` | `name` is `NOT NULL` and there is no call to source it from. Either allow validation (auto-fills) or supply `name`. |
| `name` omitted, validation attempted but transiently failed | `input_invalid` | Same reason — the auto-fill never arrived. Ask for `name` explicitly rather than inventing one from the symbol; a fabricated name is exactly the synthetic entry D1 forbids. |
| `backfill: true` and backfill throws **definitively** | `not_available` | Nothing was registered (§5.4 Path B) — the backfill runs first precisely so this case writes nothing. Report as an unknown symbol, with `searchSymbol` suggestions. |
| `backfill: true` and backfill throws **transiently** | `ok: true` | The instrument **is** registered — report success plus the backfill failure and tell the user to retry `nse_market_backfill`. Do not withhold a plausible row over a transient fetch. |
| `backfill: true` and backfill returns 0 rows | `ok: true` | Registered. 0 rows means the symbol resolved but has no candles in the window (§5.2.1) — report it as a caveat, never as a validation failure. |
| DB write fails | `execution_failed` | pass the driver message through |

---

## 6. Index registration — folded into `nse_instrument_add`

### 6.1 One tool, not two — and not a third tool either

The draft proposed a separate `nse_index_add`. The owner's 2026-08-07 brief scopes the work
to **two** tools and lists index support as a behaviour of `nse_instrument_add`: "indices go
in `instruments` with `instrument_type: 'index'` — no new table. Support registering an index
this way, and attaching constituents to `index_constituents`." So index registration is
`nse_instrument_add` with `instrument_type: 'index'` plus an optional `members` list, and no
third tool ships. Tool count is 26, not 27.

This follows from D5 anyway: given indices already live in `instruments` (§2.2), a separate
register-an-index tool would have duplicated `nse_instrument_add` for the sake of one field.
The genuinely new capability is membership, and that is one argument.

### 6.2 Arguments

Added to `InstrumentAddArgs` (§5.3), both index-only:

```typescript
members?: Array<{ symbol: string; weight?: number }>;
as_of_date?: string;   // YYYY-MM-DD, default today (IST)
```

`members` with `instrument_type` other than `'index'` is `input_invalid` — it would write
`index_constituents` rows keyed on an equity. An empty `members: []` is `input_invalid` too:
it is almost always a bug upstream, and silently accepting it looks like success.

No new store method. `upsertIndexConstituents` (`store.ts:834`) already exists and is
`INSERT OR REPLACE` keyed on `(index_symbol, member_symbol)`, so re-attaching is idempotent
per member. Unknown members are found by set-differencing against `listInstrumentSymbols()`
— one query, no new API.

### 6.3 Behaviour

- **Index row.** Same rule as §5.4 — exists and no `update` → report current values, change
  nothing. Written with `instrument_type: 'index'`, `is_active: 1`.
- **Members are attached even when the index row already exists.** The `exists` short-circuit
  governs the *instrument row*; a caller who passed `members` explicitly asked for the
  attach, so withholding it would mean "add members to an index I already registered" needed
  `update: true` for no reason. The response says both what happened to the row and what
  happened to the members.
- **Validation.** `fetchQuote(index_symbol)` — Yahoo serves index symbols (`^NSEI` is already
  used by `nse_get_index`). D1 and D3 apply unchanged. Member symbols are **not** validated
  against the feed: the list can be hundreds long, and the unknown-member reporting already
  surfaces the ones that will not scan.
- **Unknown members** are inserted anyway (`index_constituents` has no FK, and the seed data
  already contains members with no matching instrument row) but listed in the response, first
  ten plus a count, with the instruction to register them.
- **Weights** are optional. If any are supplied and they sum outside `[95, 105]`, warn — a
  plausible fractions-vs-percent error that is otherwise invisible. Warn, do not reject:
  partial constituent lists are legitimate.
- **Duplicate member symbols** are deduped, last wins, and the collapse count is reported.
- **`as_of_date`** is `NOT NULL` in the schema; it defaults to today in IST and is rejected
  unless it matches `YYYY-MM-DD`.

**Not implemented: `replace_members`.** The draft included it for rebalances (delete the
index's rows, then insert). It was not requested, and per-member upsert is already
idempotent, so it is left out rather than shipped speculatively. The gap: a member *dropped*
from an index is not removed by re-running the tool. Add it when a rebalance actually needs
it — it is a `DELETE FROM index_constituents WHERE index_symbol = ?` inside the same
transaction, guarded so it cannot run without `members`.

### 6.4 Considered and not needed — a separate `indexes` table

A dedicated `indexes` table was considered and rejected (D5): every field it would have
carried — name, provider, type, added_at — already has a home on the `instruments` row
(§2.2), and a second table would let `instruments.name` and `indexes.name` disagree with no
rule for which one wins. No new table ships.


## 7. Testing strategy — as built

New file `src/__tests__/sql-guard.test.ts` (28 cases):

- Admits: plain `SELECT`; `WITH x AS (…) SELECT …`; `UNION`; a trailing `;`;
  leading whitespace and leading `-- comment` lines; mixed case (`SeLeCt`); `sqlite_master`.
- Rejects: `INSERT` / `UPDATE` / `DELETE` / `DROP` / `CREATE` / `ALTER`;
  `PRAGMA table_info(x)`; `ATTACH DATABASE '/etc/x.db' AS y`; `VACUUM`;
  `SELECT 1; DELETE FROM instruments`; empty string; > 8 000 chars.
- **Bypass attempts** — these are the tests that matter, one per tokenizer state:
  `SELECT '; DROP TABLE instruments'` (admit — it is a string literal);
  `SELECT 1 -- ; DELETE FROM x` (admit — comment);
  `SELECT 1 /* ; DELETE */ , 2` (admit);
  `SELECT "delete" / [attach] / \`drop\`` (admit — quoted identifiers);
  `SELECT 1; /* x */ DELETE FROM instruments` (reject);
  `SELECT '''; ATTACH ''' ; ATTACH DATABASE 'x' AS y` (reject — the escaped-quote case);
  `/* SELECT */ DELETE FROM instruments` (reject — a comment must not fake the first token).

Extend `src/__tests__/store.test.ts`:

- `query()` — rows and column names; `columns: []` on an empty result; row cap enforced and
  flagged; `limit` clamped into `[1, 1000]`; the wrap preserves an inner `ORDER BY` and an
  inner `LIMIT`; `WITH` works; multi-statement, `ATTACH` and a write all throw
  `SqlGuardError`; and — separately from the guard — a raw `readOnly` handle on the same file
  refuses a write at the engine.
- The `query()` block uses a **temp file** DB, not `':memory:'` (§3.2), with a comment saying
  why.
- `upsertInstruments` soft delete — a row absent from the batch is deactivated, not deleted;
  its `ohlcv_daily` history is still reachable; a second refresh does not re-count it in
  `removed`; a symbol that returns to the batch is reactivated.
- `addInstrument` — create; `exists` on re-add with no mutation; `update: true` mutates and
  preserves `added_at`; an index row carries its `index_category`.
- `getSymbolCoverage` — zero rows for an unknown symbol, count and date range otherwise.

Extend `src/__tests__/tools.test.ts`:

- Bump `toHaveLength(24)` → `26`.
- The `toolset` loop asserted `expect(tool.toolset).toBe('market')` for **every** tool. It is
  now: `nse_market_query` is `'market_query'`, all others `'market'`.
- Add the two new names to the `toContain` list.
- New: `MARKET_QUERY_DESCRIPTION` mentions every column of every table. Build a fresh
  in-memory DB via `migrate()`, run `PRAGMA table_info` per table from `sqlite_master`,
  assert each table and column name appears in the description string. This is the drift gate
  for §3.7.

New file `src/__tests__/instrument-add.test.ts` — validation semantics (D1 / D3 / D4), driven
by stubbing `globalThis.fetch` and pointing `NSE_MARKET_DATA_DB` at a temp file:

- **Definitive miss blocks** — a 404 on the chart URL → `not_available`, and the row is
  absent afterwards. This is the D1 guarantee; it asserts on the *absence of the row*, not
  just the error code. A second case covers Yahoo's own
  `No data found, symbol may be delisted` error object.
- **Transient failure proceeds** — a 500 and a `fetch` rejection each produce `ok: true`, a
  written row, and the "could not confirm" caveat. (The draft also listed a 503; it is
  omitted deliberately — `fetchWithRetry` backs off 2s/4s/8s/16s on 503, so the case costs
  ~30 s of wall clock to prove the same branch the 500 already proves.)
- **Unrecognised error proceeds** — a failure whose message matches none of the known strings
  still registers. This is the regression guard for the "default the `else` branch to
  proceed" rule in §5.2; it fails if someone inverts the predicate.
- **Call count (D4)** — `backfill` omitted → one `range=1d` call; `backfill: true` with
  `name` → only the windowed call; `backfill: true` without `name` → both. Asserted on the
  request URLs, since both calls hit the same host and path.
- **Path B writes nothing on a definitive miss** — `backfill: true` with a 404 leaves
  `instruments`, `ohlcv_daily` and `sync_meta` all untouched. It fails if someone moves the
  insert back ahead of the backfill.
- **Zero rows is success** — a well-formed chart response with no usable candles → `ok: true`,
  row created, caveat mentions 0 rows, not `not_available`.
- **Idempotency** — an existing symbol reports its current values, makes **no** feed call at
  all, and does not overwrite.
- Index path — registers with `members`, reports unknown members; `members` on an equity and
  `validate: false` without `name` are both `input_invalid` before any network call.

`fetchQuote`, `fetchOhlcv` and `searchSymbol` are mocked via `globalThis.fetch` per
CLAUDE.md — no network in CI.

Exit gate for the whole change: `make check` clean. Unit tests are not the whole gate: both
tools were also driven against the real 195 MB database (read-only checks) and a byte copy of
it (every mutating check), including a simulated `refresh-instruments` proving a curated row
survives the sweep.

---

## 8. Implementation phases with exit gates

**Phase 1 — the soft delete (D7).** `store.upsertInstruments`: sweep becomes
`UPDATE … SET is_active = 0 … AND is_active = 1`. No schema change (D6), no CLI change (the
return shape is unchanged).
*Exit gate:* store tests prove a curated row survives `refresh-instruments`; `make check`
clean. **Done** — shipped with Phase 2, since the tool is useless without it.

**Phase 2 — `nse_instrument_add`.** `store.addInstrument` / `getInstrument` /
`getSymbolCoverage`, one tool, `fetchQuote` validation with the definitive/transient
classifier (§5.2) and `searchSymbol` suggestions, the Path A / Path B ordering split from
§5.4, and index support with `members` (§6).
*Exit gate:* idempotent per §5.5 / §6.3; every validation-semantics test in §7 passes — in
particular, a 404 leaves no row and a 500 leaves a row with a caveat; tool count 26;
`make check` clean. **Done.**

**Phase 3 — `nse_market_query` without a runtime timeout.** `src/sql-guard.ts`,
`store.readOnlyDb()` + `store.query()`, the tool, `MARKET_QUERY_DESCRIPTION`, the
drift-gate test.
*Exit gate:* every bypass test in §7 passes; `SELECT * FROM ohlcv_daily` against the real DB
comes back capped and does not exhaust memory; `make check` clean. **Done.**

**Phase 4 — worker-thread timeout for `nse_market_query`** (§3.5(a)). **Not started —
explicitly deferred by the owner.**
*Exit gate:* a deliberate cartesian product terminates at the deadline, returns
`code: 'execution_failed'` naming the timeout, and leaves the main thread responsive.

Phases 1–3 landed as two commits (query first, then curation + soft delete). Phase 4 must not
be dropped — see §9 Q1. Until it lands, the tool description tells the model in as many words
that there is no timeout and that an unconstrained join blocks the agent.

---

## 9. Open questions for the owner

**Two remain: Q4 and Q5.** Q2 is closed by D5 (indices stay as `instruments` rows, §2.2 and
§6.4). Q3 is closed by D6 — with no schema change there is no migration to record, so
`schema_version` stays untouched and dead. Q1 is answered by shipping: Phase 3 landed without
the timeout, per the recommendation below, and Phase 4 remains owed. The questions this draft
previously raised about validation strategy, validation-failure handling and the `backfill`
default are closed by D1, D3 and D2 respectively, and now live in §5.0, §5.2 and §5.3.

**The D4 interpretation in §5.2.1 is confirmed and implemented** — the 2026-08-07 brief
restates it as "with `backfill: true`, backfill first, then register", which is the reading
§5.2.1 proposed. No rewrite needed.

**Q1 — Ship `nse_market_query` before the worker-thread timeout exists?**
There is no in-process way to bound query runtime with node-sqlite3-wasm (§3.5), and the
module is synchronous, so a runaway query stalls the whole agent, not just this tool.
*Recommendation: yes, ship Phase 3 without it.* The output caps land immediately and
cover the described failure; the runtime gap needs a worker and a second code path, and
holding a useful tool hostage to that is the wrong trade. But commit to Phase 4 in the
same milestone — "temporarily unbounded" has a way of becoming permanent.

**~~Q2 — Separate `indexes` table, or indices as `instruments` rows?~~ CLOSED (D5).**
No new table. Indices are `instruments` rows with `instrument_type = 'index'`, carrying
`name`, `exchange` and `index_category`. Every field the brief wanted already had a home
(§2.2), and a second table would let `instruments.name` and `indexes.name` disagree. The
rejected DDL has been removed from §6.4 so it does not read as a live option.

**~~Q3 — Start writing `schema_version`, or leave it dead?~~ CLOSED (D6).**
D6 removed the only schema change this work had, so there is no migration to number and
nothing honest to write. `schema_version` stays created-and-empty (§2.5). The recommendation
stands for whoever ships the *next* real migration: write the row then, or drop the table in
a cleanup rather than leaving it ambiguous.

**Q4 — `store.runScan()` accepts arbitrary SQL on the read-write handle (§2.3).**
It is gated by `/^select\s/i` and, when that fails, interpolates the string into a
`WHERE` clause. Not model-reachable today (scans load from files inside the package), but
it is one "let the model save a scan" feature away from being a write primitive. *Out of
scope for this spec. Recommendation: once `sql-guard.ts` exists, route `runScan`'s
`SELECT` branch through `guardSelect()` and the read-only handle — a two-line change once
Phase 3 lands.*

**Q5 — Should `nse_market_query` be able to read `sqlite_master`?**
This spec allows it: it lets the model self-correct a hallucinated column name, and it
exposes nothing the inlined description does not. It also leaks the DDL of tables the
description omits. *Recommendation: allow it,* and use it as the pressure valve if
`MARKET_QUERY_DESCRIPTION` grows past the token budget in §3.7.

---

## Appendix: gotchas

**`prepare()` silently discards trailing statements.** `prepare('SELECT 1; DELETE FROM
instruments')` returns `[{a:1}]` with no error. Do not read "no exception" as "one
statement". The guard rejects on `;` for exactly this reason — otherwise a model that
appended a stray statement would get a plausible-looking result from half its query.

**`PRAGMA query_only = 1` does not block `ATTACH`.** Verified. A read-only connection
attaches an existing SQLite file and reads it. The tokenizer is the only thing standing
between `nse_market_query` and every `.db` on the disk. (Attaching the *same* file the
connection already holds open fails with `database is locked` — incidental, not a defence.)

**An un-finalized statement leaves a stale `<db>.lock` directory.** The wasm VFS locks with a
directory, so a process that prepares a statement and exits without `finalize()` leaves it
behind, and every later connection fails with `database is locked` until someone `rmdir`s it.
Pair every `prepare()` with a `finalize()` — `query()` does it in a `finally` so the
early-`break` out of `iterate()` is covered too.

**Duplicate output column names collapse silently.** `SELECT i.symbol, w.symbol …`
returns one `symbol` key. Rows are `Record<string, SQLiteValue>`; there is no positional
access. Tell the model to alias in `MARKET_QUERY_DESCRIPTION`.

**An empty result set has no recoverable column names.** node-sqlite3-wasm exposes no
column-metadata API, and `all()` on a zero-row query returns `[]`. `"columns": []` in
the response means "no rows", not "no columns".

**The DB is in `delete` journal mode despite `PRAGMA journal_mode = WAL`.** The wasm VFS
has no shared memory. This removes the usual read-only-connection-on-a-WAL-database
hazard, but it also means `CLAUDE.md` and `plan/tools-nse-market-data.md` §8 are wrong
about WAL. Worth a doc fix, separate from this change.

**`:memory:` cannot be shared between the read-write and read-only handles.** They are
two distinct empty databases. Any test touching `query()` needs a temp file.

**`upsertInstruments` *was* destructive, not just overwriting.** `DELETE FROM instruments
WHERE symbol NOT IN (…)` at `store.ts:824` ran on every `refresh-instruments`
(`cli.ts:488`), `init` (`cli.ts:588`), and the auto-seed inside `nse_market_backfill`
(`tools.ts:194`). A manually added symbol is never in the shipped batch, so the row was
**deleted** — not merely clobbered — and its price history orphaned. D7 replaced it with
`is_active = 0` (§4). What remains is that a curated symbol still drops out of every scan on
the next refresh; it is recoverable, not immune (§4.3).

**`fetchOhlcv` returns `[]` on success, not only on failure.** A well-formed 200 response
with no `timestamp` array, an empty quote array, or candles that all fail the null filter
yields `[]` (`fetcher.ts:135–160`), and `backfillSymbol` reports that as `rowsInserted: 0`
(`store.ts:409`). Zero rows means "resolved but no candles in this window" — a fresh listing,
a suspended scrip, or too small a `backfill_days`. Do not read it as "symbol does not exist";
under D4 that misreading would reject the fresh-IPO case outright.

**There are no foreign keys in this schema.** `PRAGMA foreign_keys = ON` is set at
`schema.ts:294`, but a grep for `REFERENCES` / `FOREIGN KEY` across `schema.ts` returns
nothing. The pragma is inert. This is what makes §5.4 Path B legal — `ohlcv_daily` and
`sync_meta` rows can exist for a symbol with no `instruments` row — and it is also why
deleting an instrument orphans its price history rather than cascading it.

**`ALTER TABLE ADD COLUMN … NOT NULL DEFAULT '<constant>'` is O(1) and legal on a STRICT
table.** It is how `instrument_type` and `is_active` were added. No table rewrite, no
backfill `UPDATE` — but the default *must* be a constant, so do not reach for
`datetime('now')`. Not used by this change (D6), kept for the next migration.

**`UPDATE … WHERE symbol NOT IN (…)` must also say `AND is_active = 1`.** Otherwise
`changes` re-counts rows that were already inactive, and the `removed` figure the CLI prints
grows on every refresh while nothing actually changed.
