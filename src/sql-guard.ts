// Statement admission for nse_market_query — pure, no DB, no network.
//
// The engine already refuses writes (read-only connection + PRAGMA query_only).
// This guard covers the two things the engine does not:
//   - ATTACH, which a read-only connection permits and which reads arbitrary
//     SQLite files off disk;
//   - trailing statements, which prepare() discards silently rather than
//     rejecting, so `SELECT 1; DROP ...` would appear to succeed.
// The DML keywords are redundant with the engine but produce a clear error
// instead of a driver-level one.

export interface GuardOk {
  ok: true;
}
export interface GuardFail {
  ok: false;
  reason: string;
}
export type GuardResult = GuardOk | GuardFail;

/** Thrown by MarketDataStore.query() when guardSelect() rejects the statement. */
export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlGuardError';
  }
}

export const MAX_SQL_CHARS = 8000;

const BANNED = new Set([
  'attach',
  'detach',
  'pragma',
  'vacuum',
  'begin',
  'commit',
  'rollback',
  'insert',
  'update',
  'delete',
  'replace',
  'create',
  'drop',
  'alter',
  'reindex',
]);

/**
 * Replace every quoted literal, quoted identifier body and comment with a single
 * space. All keyword and semicolon checks read the scrubbed copy only, so a
 * string containing "; DROP TABLE" cannot trip them and a comment cannot hide a
 * second statement.
 */
function scrub(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];

    // Line comment
    if (c === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    // Block comment (SQLite does not nest these)
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }

    // Single-quoted string: '' is an escaped quote
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += ' ';
      continue;
    }

    // Quoted identifiers: "..." and `...` (doubled delimiter escapes)
    if (c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += ' ';
      continue;
    }

    // Bracket identifier: [...] — no escape form in SQLite
    if (c === '[') {
      i++;
      while (i < sql.length && sql[i] !== ']') i++;
      i++;
      out += ' ';
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/** Strip comments and quoted literals, then admit only a single SELECT / WITH. */
export function guardSelect(sql: string): GuardResult {
  if (sql.trim().length === 0) {
    return { ok: false, reason: 'sql is required.' };
  }
  if (sql.length > MAX_SQL_CHARS) {
    return { ok: false, reason: `Query too long (${sql.length} chars, max ${MAX_SQL_CHARS}).` };
  }

  const scrubbed = scrub(sql);

  const semi = scrubbed.indexOf(';');
  if (semi !== -1 && scrubbed.slice(semi + 1).trim().length > 0) {
    return {
      ok: false,
      reason: "Only one statement per call. Remove everything after the first ';'.",
    };
  }

  const tokens = scrubbed
    .toLowerCase()
    .split(/[^a-z_]+/)
    .filter(Boolean);
  const first = tokens[0];
  if (first !== 'select' && first !== 'with') {
    return {
      ok: false,
      reason: `Only SELECT queries are allowed. Statement begins with '${first ?? ''}'.`,
    };
  }

  for (const token of tokens) {
    if (BANNED.has(token)) {
      return {
        ok: false,
        reason: `'${token}' is not allowed in nse_market_query. This tool is read-only.`,
      };
    }
  }

  return { ok: true };
}
