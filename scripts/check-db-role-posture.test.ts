/// <reference types="bun-types" />
// Tests for scripts/check-db-role-posture.mjs's pure evaluation logic. No
// network: only the exported pure functions are exercised (observePosture and
// main are the only things that open a connection, and neither is called here).
//
// The first describe block encodes the REAL production posture the PM verified
// live on 2026-09-22 (DATABASE_URL -> app_runtime, rolbypassrls=false) and
// asserts the evaluator flags it. That is the whole reason this script exists:
// if that fixture ever stops producing a mismatch without EXPECTED_POSTURE
// having been deliberately changed alongside the two stale code comments, the
// guard has gone blind.
import { describe, test, expect } from "bun:test"
import {
  ROLE_ENV_VARS,
  EXPECTED_POSTURE,
  STALE_COMMENTS,
  STATUS,
  evaluatePosture,
  evaluateAll,
  explainRow,
  enforcingExitCode,
  exitCodeFor,
  formatTable,
  toJson,
  parseArgs,
  redactionTargets,
  sanitizeErrorMessage,
} from "./check-db-role-posture.mjs"

const LIVE_2026_09_22 = {
  // pg_stat_activity: 16 app_runtime app sessions, 0 postgres; claude_log id 203
  // ("connected as `app_runtime`"); commit aebb8763 (2026-08-24).
  DATABASE_URL: { user: "app_runtime", db: "postgres", bypassrls: false, superuser: false },
  APP_RUNTIME_DATABASE_URL: { user: "app_runtime", db: "postgres", bypassrls: false, superuser: false },
}

describe("the live 2026-09-22 posture is flagged (the defect this guard exists for)", () => {
  test("DATABASE_URL authenticating as app_runtime is a MISMATCH against the code's documented assumption", () => {
    const rows = evaluateAll(LIVE_2026_09_22)
    const byVar = Object.fromEntries(rows.map((r) => [r.var, r]))
    expect(byVar.DATABASE_URL.status).toBe(STATUS.MISMATCH)
    expect(byVar.DATABASE_URL.reasons).toEqual(["bypassrls: expected true, got false"])
    expect(byVar.APP_RUNTIME_DATABASE_URL.status).toBe(STATUS.OK)
    expect(byVar.PROVISIONING_DATABASE_URL.status).toBe(STATUS.NOT_SET)
    expect(enforcingExitCode(rows)).toBe(1)
  })

  test("the mismatch explanation names BOTH stale code comments and the decision doc", () => {
    const row = evaluatePosture("DATABASE_URL", LIVE_2026_09_22.DATABASE_URL)
    const line = explainRow(row)
    expect(line.split("\n")).toHaveLength(1)
    expect(line).toContain("src/lib/db/tenant-scoped.ts:7-9")
    expect(line).toContain("src/lib/orchestra-execution-logger.ts:136-138")
    expect(line).toContain("ai-os/DB_ROLE_POSTURE_2026-09-22.md")
    expect(line).toContain("user=app_runtime")
    expect(line).toContain("bypassrls=false")
    for (const c of STALE_COMMENTS) expect(line).toContain(c)
  })

  test("the posture the code documents (a BYPASSRLS role behind DATABASE_URL) evaluates OK", () => {
    const row = evaluatePosture("DATABASE_URL", { user: "postgres", db: "postgres", bypassrls: true, superuser: false })
    expect(row.status).toBe(STATUS.OK)
    expect(row.reasons).toEqual([])
  })

  test("DATABASE_URL does not pin a user name -- any BYPASSRLS role satisfies the documented contract", () => {
    expect(EXPECTED_POSTURE.DATABASE_URL).not.toHaveProperty("user")
    const row = evaluatePosture("DATABASE_URL", { user: "cron_reader", db: "postgres", bypassrls: true, superuser: false })
    expect(row.status).toBe(STATUS.OK)
  })
})

describe("evaluatePosture: APP_RUNTIME_DATABASE_URL", () => {
  test("app_runtime without BYPASSRLS is OK", () => {
    expect(evaluatePosture("APP_RUNTIME_DATABASE_URL", { user: "app_runtime", db: "postgres", bypassrls: false, superuser: false }).status).toBe(STATUS.OK)
  })
  test("REGRESSION: app_runtime gaining BYPASSRLS is a mismatch (tenant isolation would be gone)", () => {
    const row = evaluatePosture("APP_RUNTIME_DATABASE_URL", { user: "app_runtime", db: "postgres", bypassrls: true, superuser: false })
    expect(row.status).toBe(STATUS.MISMATCH)
    expect(row.reasons).toEqual(["bypassrls: expected false, got true"])
  })
  test("REGRESSION: a different role behind APP_RUNTIME_DATABASE_URL is a mismatch even if bypassrls is false", () => {
    const row = evaluatePosture("APP_RUNTIME_DATABASE_URL", { user: "veridian_provisioning", db: "postgres", bypassrls: false, superuser: false })
    expect(row.status).toBe(STATUS.MISMATCH)
    expect(row.reasons).toEqual(["user: expected app_runtime, got veridian_provisioning"])
  })
  test("both wrong -> both reasons, in a stable order", () => {
    const row = evaluatePosture("APP_RUNTIME_DATABASE_URL", { user: "postgres", db: "postgres", bypassrls: true, superuser: false })
    expect(row.reasons).toEqual(["user: expected app_runtime, got postgres", "bypassrls: expected false, got true"])
  })
})

describe("evaluatePosture: PROVISIONING_DATABASE_URL", () => {
  test("veridian_provisioning is OK; bypassrls is not asserted for it", () => {
    expect(EXPECTED_POSTURE.PROVISIONING_DATABASE_URL).not.toHaveProperty("bypassrls")
    expect(evaluatePosture("PROVISIONING_DATABASE_URL", { user: "veridian_provisioning", db: "postgres", bypassrls: false, superuser: false }).status).toBe(STATUS.OK)
  })
  test("any other role is a mismatch", () => {
    const row = evaluatePosture("PROVISIONING_DATABASE_URL", { user: "postgres", db: "postgres", bypassrls: true, superuser: false })
    expect(row.status).toBe(STATUS.MISMATCH)
    expect(row.reasons).toEqual(["user: expected veridian_provisioning, got postgres"])
  })
})

describe("evaluatePosture: unset / unreachable / unknown", () => {
  test("null and undefined both mean not set, which is NOT a failure", () => {
    for (const observed of [null, undefined]) {
      const row = evaluatePosture("PROVISIONING_DATABASE_URL", observed)
      expect(row.status).toBe(STATUS.NOT_SET)
      expect(row.user).toBeNull()
      expect(row.reasons).toEqual([])
      expect(enforcingExitCode([row])).toBe(0)
    }
  })
  test("a set-but-unreachable string is UNREACHABLE and counts as not green in enforcing mode", () => {
    const row = evaluatePosture("DATABASE_URL", { error: "ECONNREFUSED: connect ECONNREFUSED" })
    expect(row.status).toBe(STATUS.UNREACHABLE)
    expect(row.reasons).toEqual(["could not verify: ECONNREFUSED: connect ECONNREFUSED"])
    expect(enforcingExitCode([row])).toBe(1)
    const line = explainRow(row)
    expect(line).toContain("UNVERIFIED")
    expect(line).toContain("src/lib/db/tenant-scoped.ts:7-9")
    expect(line).toContain("src/lib/orchestra-execution-logger.ts:136-138")
  })
  test("an unknown variable name throws rather than silently evaluating to OK", () => {
    expect(() => evaluatePosture("SOME_OTHER_URL", { user: "x", db: "y", bypassrls: true, superuser: false })).toThrow(/not one of/)
  })
  test("evaluateAll reports every variable in ROLE_ENV_VARS order, missing keys as not set", () => {
    const rows = evaluateAll({})
    expect(rows.map((r) => r.var)).toEqual([...ROLE_ENV_VARS])
    expect(rows.every((r) => r.status === STATUS.NOT_SET)).toBe(true)
    expect(enforcingExitCode(rows)).toBe(0)
  })
})

describe("exit codes", () => {
  const ok = evaluatePosture("APP_RUNTIME_DATABASE_URL", { user: "app_runtime", db: "postgres", bypassrls: false, superuser: false })
  const bad = evaluatePosture("DATABASE_URL", LIVE_2026_09_22.DATABASE_URL)
  const unset = evaluatePosture("PROVISIONING_DATABASE_URL", null)
  const down = evaluatePosture("DATABASE_URL", { error: "timeout" })

  test("mismatch -> 1", () => expect(exitCodeFor([ok, bad, unset])).toBe(1))
  test("all ok / not set -> 0", () => expect(exitCodeFor([ok, unset])).toBe(0))
  test("unreachable -> 1 (unverified is not green)", () => expect(exitCodeFor([ok, down])).toBe(1))
  test("--report-only -> 0 regardless, while enforcingExitCode still says 1", () => {
    expect(exitCodeFor([ok, bad, unset], { reportOnly: true })).toBe(0)
    expect(exitCodeFor([ok, down], { reportOnly: true })).toBe(0)
    expect(enforcingExitCode([ok, bad, unset])).toBe(1)
  })
})

describe("parseArgs", () => {
  test("defaults", () => expect(parseArgs([])).toEqual({ reportOnly: false, json: false, help: false }))
  test("flags, any order", () => {
    expect(parseArgs(["--json", "--report-only"])).toEqual({ reportOnly: true, json: true, help: false })
    expect(parseArgs(["--report-only"])).toEqual({ reportOnly: true, json: false, help: false })
    expect(parseArgs(["-h"]).help).toBe(true)
  })
  test("REGRESSION: a typo'd flag throws instead of silently running in enforcing/non-json mode", () => {
    expect(() => parseArgs(["--report_only"])).toThrow(/unknown argument/)
  })
})

describe("output never leaks a connection string", () => {
  const url = "postgresql://app_runtime.pcrjmlpuqsbocqfwoxod:s3cr%40t-pass@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"

  test("redactionTargets covers the whole URL and both encodings of the password", () => {
    const t = redactionTargets(url)
    expect(t).toContain(url)
    expect(t).toContain("s3cr%40t-pass")
    expect(t).toContain("s3cr@t-pass")
  })
  test("redactionTargets tolerates a malformed string", () => {
    expect(redactionTargets("not a url")).toEqual(["not a url"])
    expect(redactionTargets("")).toEqual([])
  })
  test("sanitizeErrorMessage scrubs the URL, the password, and any bare postgres:// substring", () => {
    const msg = `connect failed for ${url} (password s3cr@t-pass) also postgres://u:p@h/db`
    const out = sanitizeErrorMessage(msg, redactionTargets(url))
    expect(out).not.toContain("s3cr")
    expect(out).not.toContain("pooler.supabase.com")
    expect(out).not.toContain("postgres://u:p@h/db")
    expect(out).toContain("[redacted]")
    expect(out).toContain("[redacted-connection-string]")
  })
  test("formatTable and toJson contain only var names, never the URL, even for an unreachable row", () => {
    const row = evaluatePosture("DATABASE_URL", { error: sanitizeErrorMessage(`ECONNREFUSED ${url}`, redactionTargets(url)) })
    const table = formatTable([row])
    const json = JSON.stringify(toJson([row]))
    for (const s of [table, json]) {
      expect(s).toContain("DATABASE_URL")
      expect(s).not.toContain("s3cr")
      expect(s).not.toContain("pooler.supabase.com")
    }
  })
})

describe("formatTable", () => {
  test("one header, one rule, one line per row; not-set rows render as 'not set' with dashes", () => {
    const rows = evaluateAll(LIVE_2026_09_22)
    const lines = formatTable(rows).split("\n")
    expect(lines).toHaveLength(2 + rows.length)
    expect(lines[0]).toMatch(/^VAR\s+STATUS\s+USER\s+DB\s+BYPASSRLS\s+SUPERUSER$/)
    expect(lines[2]).toMatch(/^DATABASE_URL\s+mismatch\s+app_runtime\s+postgres\s+false\s+false$/)
    expect(lines[3]).toMatch(/^APP_RUNTIME_DATABASE_URL\s+ok\s+app_runtime\s+postgres\s+false\s+false$/)
    expect(lines[4]).toMatch(/^PROVISIONING_DATABASE_URL\s+not set\s+-\s+-\s+-\s+-$/)
  })
})

describe("toJson shape", () => {
  test("rows, summary, both exit codes, the query, the expected table, and the stale-comment list", () => {
    const rows = evaluateAll(LIVE_2026_09_22)
    const doc = toJson(rows, { reportOnly: true, checkedAt: "2026-09-22T00:00:00.000Z" })
    expect(doc.schemaVersion).toBe(1)
    expect(doc.checkedAt).toBe("2026-09-22T00:00:00.000Z")
    expect(doc.reportOnly).toBe(true)
    expect(doc.query).toMatch(/^select current_user, current_database\(\), /)
    expect(doc.rows.map((r: { var: string }) => r.var)).toEqual([...ROLE_ENV_VARS])
    expect(doc.rows[0]).toEqual({
      var: "DATABASE_URL",
      status: "mismatch",
      user: "app_runtime",
      db: "postgres",
      bypassrls: false,
      superuser: false,
      expected: { bypassrls: true },
      reasons: ["bypassrls: expected true, got false"],
      explanation: expect.stringContaining("src/lib/db/tenant-scoped.ts:7-9"),
    })
    expect(doc.rows[1].explanation).toBeNull()
    expect(doc.rows[2]).toMatchObject({ var: "PROVISIONING_DATABASE_URL", status: "not_set", user: null, explanation: null })
    expect(doc.summary).toEqual({ ok: 1, mismatch: 1, not_set: 1, unreachable: 0 })
    expect(doc.exitCode).toBe(0)
    expect(doc.enforcingExitCode).toBe(1)
    expect(doc.expectedPosture).toEqual({
      DATABASE_URL: { bypassrls: true },
      APP_RUNTIME_DATABASE_URL: { user: "app_runtime", bypassrls: false },
      PROVISIONING_DATABASE_URL: { user: "veridian_provisioning" },
    })
    expect(doc.staleComments).toEqual([...STALE_COMMENTS])
    expect(doc.decisionDoc).toBe("ai-os/DB_ROLE_POSTURE_2026-09-22.md")
    // The document must round-trip through JSON unchanged (no undefined, no functions).
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  })
})
