/// <reference types="bun-types" />
// PROJEXA automatic error and action log, on a REAL database with the REAL code: drizzle/0754_client_log_events.sql runs on
// PGlite (real Postgres as WASM) and the real client-log-service.ts SQL runs against it. Nothing in the service is faked.
//
// PROVEN
//   1. Migration applies twice (idempotent), RLS on both tables.      2. An error stores an event AND opens one grouped issue; an action stores
//   an event and opens none.   3. The same batch sent twice (a flaky network retry) changes nothing: occurrences are not inflated.
//   4. Same fingerprint from other projects/routes/batches merges into ONE issue (counts add, projects and routes union).
//   5. REGRESSION RULE: fixed + a new event that happened AFTER the fix -> 'reopened' and reopened_count 1; an event that happened BEFORE the
//   fix but arrived late (offline device) does NOT reopen it; 'ignored' stays ignored.   6. Secrets are stripped before they are stored.
//   7. Size limits hold (message 2000, stack 8000, 40 breadcrumbs, context 4KB).   8. One organisation never sees or edits another's issues.
//   9. Fix write-back: 'fixed' needs fix_summary and a fix_files entry (400 field named), sets fixed_at, stores files + commit.
// Falsifiability (done by hand, see the PR): change `i.fixed_at < EXCLUDED.last_seen_at` to `<=`-less/true in the status CASE and 5 fails;
// remove the redaction replace() calls in scrubText and 6 fails.
// Run: bun test --isolate src/lib/services/client-log-service.pglite.test.ts --timeout 60000
import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"
const svc = await import("./client-log-service")

setDefaultTimeout(60_000)

const MIGRATION = readFileSync(join(import.meta.dir, "..", "..", "..", "drizzle", "0754_client_log_events.sql"), "utf8")
const pglite = await PGlite.create()
await pglite.exec(`
CREATE SCHEMA compliance;
CREATE ROLE app_runtime; CREATE ROLE service_role;
CREATE FUNCTION compliance.current_org_id() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('app.org_id', true) $$;
`)
await pglite.exec(MIGRATION)
const db = drizzle(pglite) as never

beforeEach(async () => {
  svc.resetRateLimitForTests()
  await pglite.exec("DELETE FROM compliance.client_log_events; DELETE FROM compliance.client_error_issues;")
})
afterAll(async () => { await pglite.close() })

let n = 0
let seq = 0
const ids = () => `issue-${++seq}`
function ev(over: Record<string, unknown> = {}, now = new Date()) {
  const v = svc.validateEvent({ id: `evt-${String(++n).padStart(8, "0")}`, kind: "error", occurred_at: now.toISOString(), fingerprint: "fp-1", message: "Cannot read x", route: "/projects/1", project_id: "p1", ...over }, now)
  if (!v.ok) throw new Error(v.reason)
  return v.event
}
const ctx = { orgId: "org-1", userId: "u1" }
const ingest = (events: ReturnType<typeof ev>[], c = ctx) => svc.ingestClientLogEventsWithDb(db, c, events, ids)
const q = async (s: string) => (await pglite.query<Record<string, any>>(s)).rows
const issue = async (fp = "fp-1") => (await q(`select * from compliance.client_error_issues where fingerprint='${fp}'`))[0]
const FIX = { status: "fixed" as const, fix_summary: "Guard null x", fix_files: [{ path: "src/a.ts", change: "added null check" }], fix_commit: "abc123" }

describe("migration 0754", () => {
  test("1. applies twice and enables RLS on both tables", async () => {
    await pglite.exec(MIGRATION)
    const rls = await q("select relname, relrowsecurity from pg_class where relname in ('client_log_events','client_error_issues') order by relname")
    expect(rls).toEqual([{ relname: "client_error_issues", relrowsecurity: true }, { relname: "client_log_events", relrowsecurity: true }])
  })
})

describe("ingest + grouping", () => {
  test("2. an error stores an event and opens one issue; an action stores an event and opens none", async () => {
    await ingest([ev(), ev({ kind: "action", action_name: "save_boq", outcome: "ok", fingerprint: undefined, message: undefined })])
    expect((await q("select kind from compliance.client_log_events order by kind")).map((r) => r.kind)).toEqual(["action", "error"])
    const rows = await q("select * from compliance.client_error_issues")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ org_id: "org-1", fingerprint: "fp-1", occurrences: 1, status: "open", reopened_count: 0, project_ids: ["p1"], routes: ["/projects/1"] })
    expect((await q("select user_id from compliance.client_log_events limit 1"))[0].user_id).toBe("u1")
  })

  test("3. sending the same batch twice changes nothing (idempotent on event id)", async () => {
    const batch = [ev(), ev()]
    expect(await ingest(batch)).toEqual({ stored: 2, duplicates: 0 })
    expect(await ingest(batch)).toEqual({ stored: 0, duplicates: 2 })
    expect((await q("select count(*)::int as c from compliance.client_log_events"))[0].c).toBe(2)
    expect((await issue()).occurrences).toBe(2)
  })

  test("4. the same fingerprint from other projects, routes and batches is ONE issue", async () => {
    await ingest([ev(), ev({ project_id: "p2", route: "/boq" })])
    await ingest([ev({ project_id: "p3", route: "/projects/1" })])
    const rows = await q("select * from compliance.client_error_issues")
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences).toBe(3)
    expect(rows[0].project_ids).toEqual(["p1", "p2", "p3"])
    expect(rows[0].routes).toEqual(["/boq", "/projects/1"])
    expect(await svc.listIssuesWithDb(db, "org-1", { status: "open", projectId: "p2", limit: 10 })).toHaveLength(1)
    expect(await svc.listIssuesWithDb(db, "org-1", { status: "open", projectId: "nope", limit: 10 })).toHaveLength(0)
  })
})

describe("regression rule", () => {
  async function fixIt() {
    await ingest([ev()])
    const id = (await issue()).id
    const fixed = await svc.patchIssueWithDb(db, "org-1", id, FIX, "tester")
    expect(fixed).toMatchObject({ status: "fixed", fix_commit: "abc123", fixed_by: "tester" })
    expect(fixed!.fixed_at).toBeTruthy()
    return id
  }

  test("5a. a new event AFTER the fix reopens the issue and counts the regression", async () => {
    await fixIt()
    await ingest([ev({}, new Date(Date.now() + 3_600_000))])
    expect(await issue()).toMatchObject({ status: "reopened", reopened_count: 1, occurrences: 2 })
    await ingest([ev({}, new Date(Date.now() + 7_200_000))])
    expect(await issue()).toMatchObject({ status: "reopened", reopened_count: 1, occurrences: 3 }) // already reopened: not counted twice
  })

  test("5b. an event that happened BEFORE the fix but arrived late does NOT reopen it", async () => {
    await fixIt()
    await ingest([ev({}, new Date(Date.now() - 3_600_000))])
    expect(await issue()).toMatchObject({ status: "fixed", reopened_count: 0, occurrences: 2 })
  })

  test("5c. a fixed-again issue can reopen a second time; an ignored issue stays ignored", async () => {
    const id = await fixIt()
    await ingest([ev({}, new Date(Date.now() + 3_600_000))])
    await svc.patchIssueWithDb(db, "org-1", id, { ...FIX, fix_commit: "def456" }, null)
    await ingest([ev({}, new Date(Date.now() + 7_200_000))])
    expect(await issue()).toMatchObject({ status: "reopened", reopened_count: 2 })
    await svc.patchIssueWithDb(db, "org-1", id, { status: "ignored" }, null)
    await ingest([ev({}, new Date(Date.now() + 9_000_000))])
    expect(await issue()).toMatchObject({ status: "ignored" })
  })
})

describe("secrets and limits", () => {
  test("6. secrets are stripped before storing: headers, tokens, passwords, keys, JWTs, secret-named fields", async () => {
    const TOK = "tok" + "_live_12345"
    const VK = "vk" + "_abcdef123456"
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTYifQ", "abcdefghijk"].join(".") // assembled so secret scanners see no literal
    await ingest([
      ev({
        message: `Request failed. Authorization: Bearer abcdef1234567890 and cookie: sb-auth-token=SECRETCOOKIE; ?token=${TOK}&password=hunter2 key ${VK} ${jwt}`,
        stack: "Error\n  at fetch (https://x/api?api_key=KEY123456&ok=1)",
        breadcrumbs: [{ type: "click", label: "Sign in", authorization: "Bearer zzzzzzzzzz", password: "hunter2", url: "/login?secret=shh123" }],
        context: { browser: "Chrome", cookie: "a=b", apiKey: "k-123", nested: { Token: "t-1", ok: "fine" } },
      }),
    ])
    const dump = JSON.stringify(await q("select message, stack, breadcrumbs, context from compliance.client_log_events"))
    for (const leak of ["abcdef1234567890", "SECRETCOOKIE", TOK, "hunter2", VK, jwt, "KEY123456", "zzzzzzzzzz", "shh123", "k-123", "a=b", "t-1"]) {
      expect(dump).not.toContain(leak)
    }
    expect(dump).toContain("Chrome")
    expect(dump).toContain("fine")
    expect(dump).toContain("[redacted]")
  })

  test("7. size limits: message 2000, stack 8000, 40 breadcrumbs (the LAST ones), context under 4KB", async () => {
    const crumbs = Array.from({ length: 100 }, (_, i) => ({ step: i }))
    const bigContext: Record<string, string> = {}
    for (let i = 0; i < 100; i++) bigContext[`k${i}`] = "x".repeat(200)
    await ingest([ev({ message: "m".repeat(5000), stack: "s".repeat(20000), breadcrumbs: crumbs, context: bigContext })])
    const row = (await q("select message, stack, breadcrumbs, context from compliance.client_log_events"))[0]
    expect(row.message.length).toBe(2000)
    expect(row.stack.length).toBe(8000)
    expect(row.breadcrumbs).toHaveLength(40)
    expect(row.breadcrumbs[39]).toEqual({ step: 99 })
    expect(JSON.stringify(row.context).length).toBeLessThanOrEqual(4096)
    expect(row.context._truncated).toBe(true)
  })

  test("7b. invalid events are rejected with a reason, never thrown", () => {
    expect(svc.validateEvent(null)).toMatchObject({ ok: false })
    expect(svc.validateEvent({ id: "short", kind: "error", occurred_at: new Date().toISOString() })).toMatchObject({ ok: false })
    expect(svc.validateEvent({ id: "evt-00000001", kind: "bogus", occurred_at: new Date().toISOString() })).toMatchObject({ ok: false })
    expect(svc.validateEvent({ id: "evt-00000001", kind: "error", occurred_at: "not a date" })).toMatchObject({ ok: false })
    const noFp = svc.validateEvent({ id: "evt-00000001", kind: "error", message: "Boom 123", occurred_at: new Date().toISOString() })
    expect(noFp.ok && noFp.event.fingerprint).toMatch(/^srv:/)
  })

  test("7c. rate allowance: 120 per minute per caller, then nothing until the minute passes", () => {
    const t0 = 1_000_000
    expect(svc.takeRateAllowance("o:u", 100, t0)).toBe(100)
    expect(svc.takeRateAllowance("o:u", 50, t0 + 1000)).toBe(20)
    expect(svc.takeRateAllowance("o:u", 10, t0 + 2000)).toBe(0)
    expect(svc.takeRateAllowance("o:other", 10, t0 + 2000)).toBe(10)
    expect(svc.takeRateAllowance("o:u", 10, t0 + 61_000)).toBe(10)
  })
})

describe("reads, fix write-back and tenancy", () => {
  test("8. another organisation never sees or edits an issue", async () => {
    await ingest([ev()])
    await ingest([ev({ fingerprint: "fp-other" })], { orgId: "org-2", userId: "u9" })
    const mine = await svc.listIssuesWithDb(db, "org-1", { status: "all", limit: 10 })
    expect(mine.map((i) => i.fingerprint)).toEqual(["fp-1"])
    expect(mine[0].sample_event).toMatchObject({ fingerprint: "fp-1", message: "Cannot read x" })
    const otherId = (await issue("fp-other")).id
    expect(await svc.getIssueWithDb(db, "org-1", otherId)).toBeNull()
    await expect(svc.patchIssueWithDb(db, "org-1", otherId, { status: "ignored" }, null)).rejects.toThrow(/Issue not found/)
    expect((await issue("fp-other")).status).toBe("open")
  })

  test("9. issue detail returns the latest 20 events; timeline is chronological per project", async () => {
    const base = Date.now() - 3_600_000
    const batch = Array.from({ length: 25 }, (_, i) => ev({ project_id: "p1", kind: i % 5 === 0 ? "action" : "error", action_name: "step", fingerprint: i % 5 === 0 ? undefined : "fp-1" }, new Date(base + i * 1000)))
    await ingest(batch)
    const detail = await svc.getIssueWithDb(db, "org-1", (await issue()).id)
    expect(detail!.events).toHaveLength(20)
    const tl = await svc.timelineWithDb(db, "org-1", { projectId: "p1", limit: 100, order: "asc" })
    expect(tl).toHaveLength(25)
    expect(tl.map((e) => String(e.id))).toEqual(batch.map((e) => e.id))
    expect(await svc.timelineWithDb(db, "org-1", { projectId: "p1", limit: 3, order: "desc" })).toHaveLength(3)
    expect(await svc.timelineWithDb(db, "org-2", { projectId: "p1", limit: 100, order: "asc" })).toHaveLength(0)
  })

  test("10. 'fixed' needs fix_summary and at least one fix_files entry; the 400 names the field", () => {
    expect(svc.validatePatch({ status: "fixed", fix_files: FIX.fix_files })).toMatchObject({ ok: false, field: "fix_summary" })
    expect(svc.validatePatch({ status: "fixed", fix_summary: "x" })).toMatchObject({ ok: false, field: "fix_files" })
    expect(svc.validatePatch({ status: "fixed", fix_summary: "x", fix_files: [] })).toMatchObject({ ok: false, field: "fix_files" })
    expect(svc.validatePatch({ status: "fixed", fix_summary: "x", fix_files: [{ path: "a" }] })).toMatchObject({ ok: false, field: "fix_files" })
    expect(svc.validatePatch({ status: "weird" })).toMatchObject({ ok: false, field: "status" })
    expect(svc.validatePatch({})).toMatchObject({ ok: false })
    expect(svc.validatePatch(FIX)).toMatchObject({ ok: true })
    expect(svc.validatePatch({ status: "ignored" })).toMatchObject({ ok: true })
  })

  test("11. the stored fix keeps files and commit, and survives reopening for the next session to read", async () => {
    await ingest([ev()])
    const id = (await issue()).id
    await svc.patchIssueWithDb(db, "org-1", id, FIX, null)
    const row = (await svc.getIssueWithDb(db, "org-1", id))!.issue
    expect(row.fix_files).toEqual([{ path: "src/a.ts", change: "added null check" }])
    expect(row.fix_commit).toBe("abc123")
    await ingest([ev({}, new Date(Date.now() + 3_600_000))])
    expect((await svc.getIssueWithDb(db, "org-1", id))!.issue).toMatchObject({ status: "reopened", fix_summary: "Guard null x" })
  })
})