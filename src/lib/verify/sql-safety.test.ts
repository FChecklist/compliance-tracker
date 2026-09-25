import { describe, expect, test } from "bun:test";
import { checkReadOnlySql } from "../../../scripts/verify/lib/sql-safety.mjs";

// Lives under src/ because bunfig.toml sets [test] root = "src": a test outside it is skipped by CI.

const accepted: Array<[string, string]> = [
  ["plain count", "select count(*) from compliance.audit_logs"],
  ["trailing semicolon", "select 1;"],
  ["with query", "with x as (select 1 as n) select n from x"],
  ["keyword inside a string literal", "select count(*) from compliance.audit_logs where action = 'update'"],
  ["keyword inside a quoted identifier", 'select count(*) from compliance."set"'],
  ["semicolon inside a string literal", "select ';' as s"],
  ["mixed case", "SeLeCt count(*) FROM pg_policies"],
  ["catalog query with a function", "select count(*) from pg_proc p where has_function_privilege('anon', p.oid, 'EXECUTE')"],
];

const refused: Array<[string, string, string]> = [
  ["empty", "   ", "empty statement"],
  ["two statements", "select 1; select 2", "more than one statement"],
  ["statement then write", "select 1; delete from compliance.users", "more than one statement"],
  ["insert", "insert into compliance.users values (1)", "must start with SELECT or WITH"],
  ["update hidden in a CTE", "with x as (update compliance.users set role = 'a' returning 1) select * from x", "forbidden keyword: update"],
  ["delete hidden in a CTE", "with x as (delete from compliance.users returning 1) select * from x", "forbidden keyword: delete"],
  ["select into", "select 1 into compliance.tmp", "forbidden keyword: into"],
  ["line comment hiding a second statement", "select 1 -- ; drop table x", "SQL comments are not allowed"],
  ["block comment", "select /* x */ 1", "SQL comments are not allowed"],
  ["set_config", "select set_config('app.current_org_id', 'x', false)", "forbidden function: set_config"],
  ["nextval", "select nextval('compliance.some_seq')", "forbidden function: nextval"],
  ["pg_read_file", "select pg_read_file('/etc/passwd')", "forbidden function: pg_read_file"],
  ["dblink", "select * from dblink('host=x', 'select 1') as t(a int)", "forbidden function: dblink"],
  ["copy", "copy compliance.users to stdout", "must start with SELECT or WITH"],
  ["grant after a select", "select 1 where false; grant all on compliance.users to anon", "more than one statement"],
  ["set session", "set role postgres", "must start with SELECT or WITH"],
];

describe("checkReadOnlySql accepts read-only statements", () => {
  for (const [name, sql] of accepted) {
    test(name, () => {
      const r = checkReadOnlySql(sql);
      expect(r.ok).toBe(true);
    });
  }
  test("returns the statement without the trailing semicolon", () => {
    const r = checkReadOnlySql("select 1 ;  ");
    expect(r).toEqual({ ok: true, sql: "select 1" });
  });
});

describe("checkReadOnlySql refuses anything that could write or hide a statement", () => {
  for (const [name, sql, reason] of refused) {
    test(name, () => {
      const r = checkReadOnlySql(sql);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    });
  }
  test("non-string input is refused", () => {
    // @ts-expect-error deliberate bad input
    expect(checkReadOnlySql(undefined).ok).toBe(false);
  });
});
