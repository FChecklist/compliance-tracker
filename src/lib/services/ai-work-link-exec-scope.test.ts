/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register row AW-506; spec 9.10): the same-project id check of the Universal AI Work Link write path, proven THROUGH the
// exec function. A link is pinned to one project. Every function that takes the id of a record (a roster member, an issue, a BOQ line, a BOQ) must
// refuse the id of ANOTHER project of the same organisation, and write NOTHING: no attendance, no hours, no progress entry, no BOQ. The refusal is
// RECORD_NOT_FOUND / BOQ_LINE_NOT_FOUND (not "exists elsewhere"), so the answer does not confirm that the other project's record exists.
//
// The intent side is real SQL on PGlite; the exec handler and the pipeline are real; the business database is the fake tenant database, whose where
// evaluation is the REAL drizzle clause (fake-tenant-db.ts), so an executor that stops scoping a lookup to its project makes the other project's row
// visible, the write land in the store and these tests fail.
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. executor.ts onAnotherProject: return false for "roster"                                   -> "a roster member of another project ..." fails
//   2. construction-boq-service / executor: look the BOQ line up by id only, not inside the project's own BOQ -> "a BOQ line of another project ..." fails
//   3. executor.ts executeRecordTimesheet: skip the issue's project check                        -> "an issue of another project ..." fails
//   4. executor.ts executeCreateBoqRevision: skip the parent BOQ's project check                 -> "a BOQ of another project ..." fails
//   5. link-exec-entry.ts buildRunInput: drop projectScope                                       -> "an id-taking call handed a project that is not the link's ..." fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-exec-scope.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleExec, type ExecDeps } from "../../../supabase/functions/ai-work-link-exec/handler"
import type { FakeStore } from "@/lib/pipeline/fake-tenant-db"
import { one } from "./__test-helpers__/awl-pglite"
import { intentRow, mintLink, openWriteDb, recordIntent, rpcFor, setWrites, type J } from "./__test-helpers__/awl-write-fixture"
import { FAKE_ORG, FAKE_PROJECT_A, FAKE_PROJECT_B, FAKE_USER, freshStore, installExecMocks, seedExecPeople, type ExecMocks } from "./__test-helpers__/awl-exec-fixture"

setDefaultTimeout(60_000)

const SECRET = "test-secret-value-of-some-length"
const TODAY = "2026-09-26"
let store: FakeStore = freshStore()
let mocks: ExecMocks
let runLinkIntent: typeof import("@/lib/pipeline/link-exec-entry").runLinkIntent
let db: PGlite
let n = 0
const key = () => `scope-${++n}`

beforeAll(async () => {
  mocks = await installExecMocks(() => store)
  ;({ runLinkIntent } = await import("@/lib/pipeline/link-exec-entry"))
  db = await openWriteDb()
  await seedExecPeople(db)
}, 120_000)
afterAll(async () => {
  await mocks.restore()
  await db.close()
})

let silenced: Array<{ mockRestore: () => void }> = []
beforeEach(() => {
  store = freshStore()
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})]
})
afterEach(async () => {
  for (const s of silenced) s.mockRestore()
  await setWrites(db, false)
})

const deps = (): ExecDeps => ({ rpc: rpcFor(db), secret: SECRET, dbConfigured: true, run: runLinkIntent, health: async () => ({ db_role: "app_runtime" }), log: () => {} })

async function exec(intentId: string): Promise<J> {
  const res = await handleExec(
    new Request("https://x.supabase.co/functions/v1/ai-work-link-exec/run", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ intent_id: intentId }) }),
    deps(),
  )
  return (await res.json()) as J
}

/**
 * Records the call on a level-1 link of project A and runs it. A level-1 function is an action; a level-2 function (create_boq_revision) is a draft the
 * person confirms first, which is how it reaches the executor in production.
 */
async function viaLink(fn: string, params: Record<string, unknown>, how: "action" | "draft" = "action"): Promise<{ out: J; intentId: string }> {
  await setWrites(db, true)
  const link = await mintLink(db, FAKE_USER, FAKE_PROJECT_A, { level: 1 })
  const rec = await recordIntent(db, link.token, how, fn, params, key())
  if (how === "draft") {
    const c = (await one<{ r: J }>(db, "select public.ai_work_link_draft_confirm($1, $2, $3) r", [rec.intent_id, rec.confirm_token, FAKE_USER])).r
    expect(c.status).toBe("confirmed")
  }
  return { out: await exec(rec.intent_id), intentId: rec.intent_id }
}

const rows = (t: string) => store.tables[t] ?? []
const businessRows = () => ({
  attendance: rows("construction_attendance").length,
  timeEntries: rows("pms_time_entries").length,
  progress: rows("construction_work_progress_entries").length,
  boqs: rows("construction_boqs").length,
  boqLines: rows("construction_boq_line_items").length,
})
const BASELINE = { attendance: 0, timeEntries: 0, progress: 0, boqs: 2, boqLines: 2 }

describe("an id of another project of the same organisation is refused, and 0 rows are written", () => {
  test("a roster member of another project: RECORD_NOT_FOUND (worker), no attendance; the same call with the link's own roster member is written", async () => {
    const bad = await viaLink("record_attendance", { rosterId: "roster_b", date: TODAY })
    expect(bad.out).toMatchObject({ status: "failed", code: "RECORD_NOT_FOUND", missing: ["worker"] })
    expect(await intentRow(db, bad.intentId)).toMatchObject({ status: "failed", failure: { code: "RECORD_NOT_FOUND", missing: ["worker"] } })
    expect(businessRows()).toEqual(BASELINE)

    const good = await viaLink("record_attendance", { rosterId: "roster_a", date: TODAY })
    expect(good.out.status).toBe("done")
    expect(rows("construction_attendance").map((r) => [r.projectId, r.rosterId])).toEqual([[FAKE_PROJECT_A, "roster_a"]])
  })

  test("an issue of another project: RECORD_NOT_FOUND (task), no hours logged; the link's own issue is logged", async () => {
    const bad = await viaLink("record_timesheet", { issueId: "issue_b", hours: 2 })
    expect(bad.out).toMatchObject({ status: "failed", code: "RECORD_NOT_FOUND", missing: ["task"] })
    expect(businessRows()).toEqual(BASELINE)

    const good = await viaLink("record_timesheet", { issueId: "issue_a", hours: 2 })
    expect(good.out.status).toBe("done")
    expect(rows("pms_time_entries").map((r) => [r.issueId, r.userId, r.hours])).toEqual([["issue_a", FAKE_USER, "2.00"]])
  })

  test("a BOQ line of another project: BOQ_LINE_NOT_FOUND, no progress entry", async () => {
    const before = JSON.stringify(rows("construction_work_progress_entries"))
    const bad = await viaLink("record_work_progress", { boqLineItemId: "line_b", percent: 40 })
    expect(bad.out).toMatchObject({ status: "failed", code: "BOQ_LINE_NOT_FOUND" })
    expect(JSON.stringify(rows("construction_work_progress_entries"))).toBe(before)
    expect(businessRows()).toEqual(BASELINE)
  })

  test("a BOQ of another project: RECORD_NOT_FOUND (boqVersion), no BOQ revision written (a confirmed draft, as a level-2 function reaches the executor)", async () => {
    const bad = await viaLink("create_boq_revision", { boqId: "boq_b", title: "Rev 2" }, "draft")
    expect(bad.out).toMatchObject({ status: "failed", code: "RECORD_NOT_FOUND", missing: ["boqVersion"] })
    expect(await intentRow(db, bad.intentId)).toMatchObject({ status: "failed", kind: "draft" })
    expect(businessRows()).toEqual(BASELINE)
  })

  test("a record of another project and a record that does not exist are BOTH RECORD_NOT_FOUND with no write (the code does not say which)", async () => {
    // FINDING, reported to the PM: the two answers differ in `missing` (["worker"] for another project's member, [] for an id that exists nowhere,
    // because the executor checks the other project first and lets a missing id reach the service's own 404). The code is the same.
    const other = await viaLink("record_attendance", { rosterId: "roster_b", date: TODAY })
    const nothing = await viaLink("record_attendance", { rosterId: "roster_does_not_exist", date: TODAY })
    expect(other.out).toMatchObject({ status: "failed", code: "RECORD_NOT_FOUND" })
    expect(nothing.out).toMatchObject({ status: "failed", code: "RECORD_NOT_FOUND" })
    expect(businessRows()).toEqual(BASELINE)
  })

  test("every lookup above was evaluated for real (the fake refused no where clause)", async () => {
    await viaLink("record_attendance", { rosterId: "roster_b", date: TODAY })
    await viaLink("record_timesheet", { issueId: "issue_b", hours: 2 })
    await viaLink("create_boq_revision", { boqId: "boq_b" }, "draft")
    expect(store.unparsed).toEqual([])
  })
})

describe("the project is the link's, whatever the parameters say", () => {
  const claim = (params: Record<string, unknown>) => ({
    intent: { id: "int-x", kind: "action", function_id: "record_attendance", params },
    ctx: { link_id: "link-x", org_id: FAKE_ORG, user_id: FAKE_USER, project_id: FAKE_PROJECT_A, live_role: "manager", live_rank: 3, effective_level: 1, money_visible: true },
  })

  test("an id-taking call handed a project that is not the link's is PROJECT_NOT_REACHABLE, and nothing is written (record_intent refuses it earlier; this is the second line)", async () => {
    const out = await runLinkIntent(claim({ projectId: FAKE_PROJECT_B, rosterId: "roster_b", date: TODAY }))
    expect(out).toMatchObject({ status: "failed", code: "PROJECT_NOT_REACHABLE" })
    expect(businessRows()).toEqual(BASELINE)
    expect(store.writes).not.toContain("insert:construction_attendance")
    expect(rows("pipeline_tasks")).toEqual([])
  })

  test("with no project in the parameters the link's project is used; with the link's own project it is the same", async () => {
    expect((await runLinkIntent(claim({ rosterId: "roster_a", date: TODAY }))).status).toBe("done")
    expect(rows("construction_attendance").map((r) => r.projectId)).toEqual([FAKE_PROJECT_A])
    store = freshStore()
    expect((await runLinkIntent(claim({ projectId: FAKE_PROJECT_A, rosterId: "roster_a", date: TODAY }))).status).toBe("done")
    expect(rows("construction_attendance").map((r) => r.projectId)).toEqual([FAKE_PROJECT_A])
  })

  test("a claim that is missing a field, or names a function with no writer, is refused before anything is written", async () => {
    expect(await runLinkIntent({ intent: { id: "i", kind: "action", function_id: "record_attendance", params: {} }, ctx: { link_id: "l", org_id: "", user_id: "u", project_id: "p", live_role: "manager" } })).toEqual({ status: "failed", code: "BAD_CLAIM", missing: [] })
    expect(await runLinkIntent({ ...claim({}), intent: { id: "i", kind: "action", function_id: "get_boq_line_items", params: {} } })).toMatchObject({ status: "failed", code: "FUNCTION_NOT_AVAILABLE" })
    expect(await runLinkIntent({ ...claim({}), intent: { id: "i", kind: "action", function_id: "no_such_function", params: {} } })).toMatchObject({ status: "failed", code: "FUNCTION_NOT_AVAILABLE" })
    expect(store.writes).toEqual([])
  })
})
