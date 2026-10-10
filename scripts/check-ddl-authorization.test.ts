/// <reference types="bun-types" />
// Real automated test for the DDL Authorization Check (see
// scripts/check-ddl-authorization.mjs's own header for the full 2026-09-29
// SEC-06 finding this closes -- the original claude-control mechanism has
// had zero live invocation path since the VERIDIAN-DEV Hetzner server was
// deleted 2026-08-25, and this is its re-homed, deliberately narrower
// replacement running as a real CI gate in THIS repo).
//
// Same convention as the sibling checks (check-migration-integrity.test.ts,
// check-migration-schema-drift.test.ts): test the actual pure functions the
// CI job calls directly (no mocked internals, no temp git fixture repo --
// the content-scanning/citation-validation logic under test here doesn't
// touch git at all, only isRealReference's KE-id branch does, and it's
// exercised against this real checkout's actual ai-os/ directory below).
import { describe, test, expect } from "bun:test"
import {
  stripSqlComments,
  findDestructiveHits,
  isRealReference,
  findValidCitation,
  DESTRUCTIVE_PATTERNS,
} from "./check-ddl-authorization.mjs"

describe("findDestructiveHits -- (a) additive-only DDL needs no citation", () => {
  test("CREATE TABLE alone is not destructive", () => {
    const sql = 'CREATE TABLE IF NOT EXISTS compliance.foo (\n  id text primary key\n);\n'
    expect(findDestructiveHits(sql)).toEqual([])
  })

  test("ALTER TABLE ADD COLUMN alone is not destructive", () => {
    const sql = "ALTER TABLE compliance.foo ADD COLUMN IF NOT EXISTS bar text;\n"
    expect(findDestructiveHits(sql)).toEqual([])
  })

  test("CREATE TABLE + ADD COLUMN together, still nothing destructive -- a real migration would pass with no citation line at all", () => {
    const sql = [
      "CREATE TABLE IF NOT EXISTS compliance.widgets (id text primary key);",
      "ALTER TABLE compliance.widgets ADD COLUMN IF NOT EXISTS name text;",
    ].join("\n")
    expect(findDestructiveHits(sql)).toEqual([])
    // No PRE-APPROVED-LIVE-DDL line present at all -- findValidCitation must
    // not be required to return anything for this file to be considered OK;
    // the CLI's own logic (see main()) only calls findValidCitation when
    // findDestructiveHits found something in the first place.
    expect(findValidCitation(sql)).toBeNull()
  })
})

describe("findDestructiveHits + findValidCitation -- (b) DROP TABLE with no citation is a violation", () => {
  test("DROP TABLE, no PRE-APPROVED-LIVE-DDL line at all", () => {
    const sql = "DROP TABLE compliance.legacy_widgets;\n"
    const hits = findDestructiveHits(sql)
    expect(hits).toContain("DROP TABLE")
    expect(findValidCitation(sql)).toBeNull()
  })
})

describe("(c) DROP TABLE + a valid dated citation passes", () => {
  test("a real, dated, meaningful-length approval note clears the citation check", () => {
    const sql = [
      "DROP TABLE compliance.legacy_widgets;",
      "-- PRE-APPROVED-LIVE-DDL: Owner approved via Slack DM on 2026-09-29, see #ops-approvals",
      "",
    ].join("\n")
    expect(findDestructiveHits(sql)).toContain("DROP TABLE")
    expect(findValidCitation(sql)).toBe(
      "Owner approved via Slack DM on 2026-09-29, see #ops-approvals"
    )
  })
})

describe("(d) DROP TABLE + a fabricated-but-well-formed KE-id still fails", () => {
  test("a KE-id that matches the grammar but does not exist anywhere under ai-os/ is rejected", () => {
    const sql = [
      "DROP TABLE compliance.legacy_widgets;",
      "-- PRE-APPROVED-LIVE-DDL: KE-99999999-999999-dead",
      "",
    ].join("\n")
    expect(findDestructiveHits(sql)).toContain("DROP TABLE")
    // isRealReference's KE-id branch runs a real `git grep` against this
    // checkout's actual ai-os/ directory -- a fabricated id genuinely does
    // not exist there, so this must fail exactly like the original
    // ddl_authorization_check.py's citation-existence checks (conditions
    // 4-10) would for a made-up reference.
    expect(isRealReference("KE-99999999-999999-dead")).toBe(false)
    expect(findValidCitation(sql)).toBeNull()
  })
})

describe("(e) a bare placeholder word does not pass", () => {
  test("`yes` alone is not a citation", () => {
    const sql = [
      "DROP TABLE compliance.legacy_widgets;",
      "-- PRE-APPROVED-LIVE-DDL: yes",
      "",
    ].join("\n")
    expect(findDestructiveHits(sql)).toContain("DROP TABLE")
    expect(findValidCitation(sql)).toBeNull()
  })

  test("REGRESSION: other common placeholders are also rejected (`approved`, `tbd`, `n/a`, `pending`)", () => {
    for (const placeholder of ["approved", "tbd", "n/a", "pending", "TODO"]) {
      expect(isRealReference(placeholder)).toBe(false)
    }
  })
})

describe("stripSqlComments -- a keyword mentioned only inside a comment does not count", () => {
  test("a DROP TABLE inside a line comment is ignored", () => {
    const sql = "-- DROP TABLE compliance.should_not_count;\nCREATE TABLE compliance.real_one (id text);\n"
    expect(findDestructiveHits(sql)).toEqual([])
  })

  test("a DROP TABLE inside a block comment is ignored", () => {
    const sql = "/* DROP TABLE compliance.should_not_count; */\nCREATE TABLE compliance.real_one (id text);\n"
    expect(findDestructiveHits(sql)).toEqual([])
  })

  test("a real DROP TABLE outside any comment is still caught even when a comment is also present", () => {
    const sql = "-- some note\nDROP TABLE compliance.real_drop;\n"
    expect(findDestructiveHits(sql)).toContain("DROP TABLE")
  })
})

describe("findDestructiveHits -- coverage of the other destructive keyword classes", () => {
  test("TRUNCATE, GRANT, REVOKE, SECURITY DEFINER, REASSIGN OWNED are each recognized", () => {
    expect(findDestructiveHits("TRUNCATE compliance.foo;")).toContain("TRUNCATE")
    expect(findDestructiveHits("GRANT SELECT ON compliance.foo TO app_runtime;")).toContain("GRANT")
    expect(findDestructiveHits("REVOKE SELECT ON compliance.foo FROM app_runtime;")).toContain("REVOKE")
    expect(findDestructiveHits("CREATE FUNCTION compliance.f() RETURNS void AS $$ $$ LANGUAGE sql SECURITY DEFINER;")).toContain("SECURITY DEFINER")
    expect(findDestructiveHits("REASSIGN OWNED BY old_role TO new_role;")).toContain("REASSIGN OWNED")
  })

  test("a plain CREATE INDEX / CREATE ROLE-free additive statement never trips any destructive pattern", () => {
    // sanity: DESTRUCTIVE_PATTERNS itself does not include CREATE TABLE/INDEX
    expect(Object.keys(DESTRUCTIVE_PATTERNS)).not.toContain("CREATE TABLE")
    expect(Object.keys(DESTRUCTIVE_PATTERNS)).not.toContain("CREATE INDEX")
  })
})
