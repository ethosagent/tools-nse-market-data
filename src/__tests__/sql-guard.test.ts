import { describe, expect, it } from 'vitest';
import { guardSelect } from '../sql-guard';

function admits(sql: string): boolean {
  return guardSelect(sql).ok;
}

function reason(sql: string): string {
  const result = guardSelect(sql);
  return result.ok ? '' : result.reason;
}

describe('guardSelect()', () => {
  describe('admits', () => {
    it('a plain SELECT', () => {
      expect(admits('SELECT symbol FROM instruments')).toBe(true);
    });

    it('a WITH ... SELECT', () => {
      expect(admits('WITH x AS (SELECT 1 AS a) SELECT a FROM x')).toBe(true);
    });

    it('a compound UNION select', () => {
      expect(admits('SELECT 1 AS a UNION SELECT 2 AS a')).toBe(true);
    });

    it('a single trailing semicolon', () => {
      expect(admits('SELECT 1 AS a;')).toBe(true);
      expect(admits('SELECT 1 AS a;   \n ')).toBe(true);
    });

    it('leading whitespace and a leading comment', () => {
      expect(admits('  -- what follows is fine\n  SELECT 1 AS a')).toBe(true);
    });

    it('mixed case', () => {
      expect(admits('SeLeCt 1 AS a')).toBe(true);
    });

    it('sqlite_master reads', () => {
      expect(admits("SELECT sql FROM sqlite_master WHERE name = 'instruments'")).toBe(true);
    });
  });

  describe('rejects', () => {
    it.each([
      ['INSERT INTO instruments (symbol) VALUES (1)', 'insert'],
      ["UPDATE instruments SET name = 'x'", 'update'],
      ['DELETE FROM instruments', 'delete'],
      ['DROP TABLE instruments', 'drop'],
      ['CREATE TABLE t (a TEXT)', 'create'],
      ['ALTER TABLE instruments ADD COLUMN x TEXT', 'alter'],
      ['VACUUM', 'vacuum'],
      ['PRAGMA table_info(instruments)', 'pragma'],
      ["ATTACH DATABASE '/etc/x.db' AS y", 'attach'],
    ])('%s', (sql) => {
      expect(admits(sql)).toBe(false);
    });

    it('an empty string', () => {
      expect(admits('')).toBe(false);
      expect(admits('   \n ')).toBe(false);
      expect(reason('')).toContain('required');
    });

    it('a trailing statement after the first one', () => {
      expect(admits('SELECT 1; DELETE FROM instruments')).toBe(false);
      expect(reason('SELECT 1; DELETE FROM instruments')).toContain('Only one statement');
    });

    it('an over-long query', () => {
      const sql = `SELECT ${'a'.repeat(8100)}`;
      expect(admits(sql)).toBe(false);
      expect(reason(sql)).toContain('too long');
    });

    it('an ATTACH hidden after a SELECT', () => {
      expect(admits("SELECT 1; ATTACH DATABASE '/tmp/x.db' AS y")).toBe(false);
    });

    it('names the offending keyword', () => {
      expect(reason("ATTACH DATABASE '/etc/x.db' AS y")).toContain("'attach'");
    });
  });

  // These are the tests that matter — one per tokenizer state.
  describe('bypass attempts', () => {
    it('admits a banned keyword inside a string literal', () => {
      expect(admits("SELECT '; DROP TABLE instruments' AS a")).toBe(true);
    });

    it('admits a banned keyword inside a line comment', () => {
      expect(admits('SELECT 1 AS a -- ; DELETE FROM instruments')).toBe(true);
    });

    it('admits a banned keyword inside a block comment', () => {
      expect(admits('SELECT 1 /* ; DELETE */ , 2')).toBe(true);
    });

    it('admits a banned keyword inside a quoted identifier', () => {
      expect(admits('SELECT "delete" FROM instruments')).toBe(true);
      expect(admits('SELECT [attach] FROM instruments')).toBe(true);
      expect(admits('SELECT `drop` FROM instruments')).toBe(true);
    });

    it('rejects a second statement hidden behind a block comment', () => {
      expect(admits('SELECT 1; /* x */ DELETE FROM instruments')).toBe(false);
    });

    it('rejects an ATTACH after an escaped-quote decoy', () => {
      expect(admits("SELECT '''; ATTACH ''' ; ATTACH DATABASE 'x' AS y")).toBe(false);
    });

    it('rejects a statement that only looks like a SELECT after a comment', () => {
      expect(admits('/* SELECT */ DELETE FROM instruments')).toBe(false);
    });
  });
});
