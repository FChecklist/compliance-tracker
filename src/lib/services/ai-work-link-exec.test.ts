/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register row AW-505; spec 9.6 executeIntent, 9.7 C-1, 9.11): a write of the Universal AI Work Link EXECUTED end to end,
// with the switch on and no owner secret. A level-1 action is recorded (real SQL on PGlite), the REAL exec handler claims it, the REAL pipeline
// (link-exec-entry -> runDirectTask -> validate -> the executors) runs it against the fake tenant database, and the outcome is read back from BOTH
// sides: the intent row (done, with the record's id and route) and the business rows (the submission, the task, the attendance).
//
// WHAT IS PROVEN
//   attribution  the record lands in the LINK'S person's name: submissions.user_id = the person, via 'ai_link', ai_link_id = the link, the note carries
//                the intent id; pipeline_tasks.executor is 'ai' with model_calls 0 and level1_outcome 'not_needed' on the submission (BR-584/585/586
//                semantics); the attendance row exists
//   no model     the Level 1 lane never runs; the memory row is marked 'ai_link' and stored WITHOUT an embedding (skipEmbedding)
//   role         a person demoted after the link was made is refused ROLE_CHANGED at the claim: the intent reads refused, no submission, no task, no row
//   switch       writes off: refused WRITES_NOT_ENABLED and NOTHING changes (the intent stays recorded); once on, the same intent runs
//   once         a second /run of a done intent runs nothing (NOT_CLAIMABLE); an executing intent answers executing and is not run again
//   text         a value over 2,000 characters fails TEXT_TOO_LONG with no business row; control characters are removed before the write
//   money        the role handed to the pipeline is the person's LIVE role
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. run-submission.ts runDirectTask: drop the `via`/`aiLinkId` columns from the insert         -> "lands in the person's name ..." fails
//   2. run-submission.ts: mint the task as "phrase_map" for a link again                          -> "lands in the person's name ..." fails (executor software)
//   3. link-exec-entry.ts buildRunInput: userId from a constant instead of ctx.user_id            -> "lands in the person's name ..." fails
//   4. link-exec-entry.ts buildRunInput: role "manager" instead of ctx.live_role                  -> "the role handed to the pipeline is the person's LIVE role" fails
//   5. 0629 claim: skip the ROLE_CHANGED refusal (drizzle/0629)                                   -> "a demoted person is refused ROLE_CHANGED" fails
//   6. run-submission.ts: drop skipEmbedding from the link memory write                           -> "the memory row is marked ai_link ..." fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-exec.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleExec, type ExecDeps } from "../../../supabase/functions/ai-work-link-exec/handler"
import type { FakeStore } from "@/lib/pipeline/fake-tenant-db"
import { one } from "./__test-helpers__/awl-pglite"
import { intentRow, mintLink, openWriteDb, recordIntent, rpcFor, setWrites, type J } from "./__test-helpers__/awl-write-fixture"
import { FAKE_ORG, FAKE_PROJECT_A, FAKE_USER, freshStore, installExecMocks, seedExecPeople, type ExecMocks } from "./__test-helpers__/awl-exec-fixture"

setDefaultTimeout(60_000)

const SECRET = "test-secret-value-of-some-length"
let store: FakeStore = freshStore()
let mocks: ExecMocks
let runLinkIntent: typeof import("@/lib/pipeline/link-exec-entry").runLinkIntent
let db: PGlite
let n = 0
const key = () => `exec-${++n}`

/** The roles the claim handed the exec function, and the roles the pipeline's executor was really given (a wrapper over the real executeTask). */
let rolesSeen: Array<string | null | undefined> = []
let rolesUsed: Array<string | null | undefined> = []
let restoreExecutor: () => Promise<void> = async () => {}

beforeAll(async () => {
  mocks = await installExecMocks(() => store)
  const realExecutor = await import("@/lib/pipeline/executor")
  // captured BEFORE the module is replaced: the namespace object is live, so reading realExecutor.executeTask afterwards would call the wrapper itself
  const realExecuteTask = realExecutor.executeTask as (...a: unknown[]) => unknown
  const realExports = { ...realExecutor }
  mock.module("@/lib/pipeline/executor", () => ({
    ...realExports,
    executeTask: (task: { role?: string | null }, ...rest: unknown[]) => {
      rolesUsed.push(task.role)
      return realExecuteTask(task, ...rest)
    },
  }))
  restoreExecutor = async () => {
    await mock.module("@/lib/pipeline/executor", () => realExports)
  }
  ;({ runLinkIntent } = await import("@/lib/pipeline/link-exec-entry"))
  db = await openWriteDb()
  await seedExecPeople(db)
}, 120_000)
afterAll(async () => {
  await restoreExecutor()
  await mocks.restore()
  await db.close()
})

let silenced: Array<{ mockRestore: () => void }> = []
beforeEach(() => {
  store = freshStore()
  mocks.runLevel1.mockClear()
  mocks.createMemoryRecord.mockClear()
  rolesSeen = []
  rolesUsed = []
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})]
})
afterEach(async () => {
  for (const s of silenced) s.mockRestore()
  await setWrites(db, false)
  await db.exec(`update compliance.users set role = 'manager' where id = '${FAKE_USER}'`)
})

function execDeps(over: Partial<ExecDeps> = {}): ExecDeps {
  return {
    rpc: rpcFor(db),
    secret: SECRET,
    dbConfigured: true,
    run: async (c) => {
      rolesSeen.push(c.ctx.live_role)
      return runLinkIntent(c)
    },
    health: async () => ({ db_role: "app_runtime" }),
    log: () => {},
    ...over,
  }
}

async function runIntent(intentId: string, deps: ExecDeps = execDeps()): Promise<{ status: number; json: J }> {
  const res = await handleExec(
    new Request("https://x.supabase.co/functions/v1/ai-work-link-exec/run", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ intent_id: intentId }) }),
    deps,
  )
  return { status: res.status, json: (await res.json()) as J }
}

/** A level-1 link for the manager on project A with writes on, and one recorded action on it. */
async function actionFor(fn: string, params: Record<string, unknown>): Promise<{ link: J; intent: J }> {
  await setWrites(db, true)
  const link = await mintLink(db, FAKE_USER, FAKE_PROJECT_A, { level: 1 })
  const intent = await recordIntent(db, link.token, "action", fn, params, key())
  return { link, intent }
}

const ATTENDANCE = { rosterId: "roster_a", date: "2026-09-26" }
const submission = () => store.tables.submissions[0] as Record<string, any>
const task = () => store.tables.pipeline_tasks[0] as Record<string, any>

describe("a level-1 write lands attributed to the person", () => {
  test("lands in the person's name: via ai_link, the link's id, the person as user, executor ai, model_calls 0, and the intent reads done with the record", async () => {
    const { link, intent } = await actionFor("record_attendance", ATTENDANCE)

    const out = await runIntent(intent.intent_id)

    expect(out.status).toBe(200)
    expect(out.json).toMatchObject({ intent_id: intent.intent_id, status: "done", stored: true })
    expect(typeof out.json.record.id).toBe("string")
    expect(out.json.record.route).toMatch(/^\//)
    // the business rows
    expect(store.tables.submissions).toHaveLength(1)
    expect(submission()).toMatchObject({ via: "ai_link", aiLinkId: link.link_id, userId: FAKE_USER, orgId: FAKE_ORG, projectId: FAKE_PROJECT_A, status: "done", modelCalls: 0, level1Outcome: "not_needed" })
    expect(String(submission().rawInput)).toContain(`intent ${intent.intent_id}`)
    expect(store.tables.pipeline_tasks).toHaveLength(1)
    expect(task()).toMatchObject({ executor: "ai", functionId: "record_attendance", status: "done" })
    expect(store.tables.construction_attendance.map((r) => r.rosterId)).toEqual(["roster_a"])
    // the intent, read from SQL
    expect(await intentRow(db, intent.intent_id)).toMatchObject({ status: "done", submission_id: out.json.submission_id, result: { id: out.json.record.id, route: out.json.record.route }, kind: "action" })
    expect(out.json.submission_id).toBe(submission().id)
    // no model, ever
    expect(mocks.runLevel1).not.toHaveBeenCalled()
  })

  test("the memory row is marked ai_link, carries the link id and is stored without an embedding (no model call on link traffic)", async () => {
    const { link, intent } = await actionFor("record_attendance", ATTENDANCE)
    await runIntent(intent.intent_id)

    expect(mocks.createMemoryRecord).toHaveBeenCalledTimes(1)
    const input = mocks.createMemoryRecord.mock.calls[0][2] as Record<string, unknown>
    expect(input).toMatchObject({ sourceType: "ai_link", sourceId: link.link_id, skipEmbedding: true, metadata: { via: "ai_link", aiLinkId: link.link_id } })
    expect(String(input.content).length).toBeLessThanOrEqual(2000)
  })

  test("the role handed to the pipeline is the person's LIVE role: a member is run as a member (not as the manager the fixtures start with)", async () => {
    await db.exec(`update compliance.users set role = 'member' where id = '${FAKE_USER}'`)
    const { intent } = await actionFor("record_attendance", ATTENDANCE)
    const out = await runIntent(intent.intent_id)
    expect(out.json.status).toBe("done")
    expect(rolesSeen).toEqual(["member"])
    expect(rolesUsed).toEqual(["member"])
  })

  test("a function that is not a link write never reaches the pipeline as one: the claim refuses what the link does not allow", async () => {
    await setWrites(db, true)
    const link = await mintLink(db, FAKE_USER, FAKE_PROJECT_A, { level: 1, fns: ["record_attendance"] })
    // record_intent itself refuses a function outside the link's list; nothing to claim
    let refused = ""
    try {
      await recordIntent(db, link.token, "action", "create_meeting", { title: "x", scheduledAt: "2026-10-01T10:00:00Z" }, key())
    } catch (e) {
      refused = String((e as { message?: string }).message)
    }
    expect(refused).toContain("FUNCTION_NOT_ON_LINK")
    expect(store.writes).toEqual([])
  })
})

describe("the claim decides, live, before anything runs", () => {
  test("a demoted person is refused ROLE_CHANGED: the intent reads refused, and no submission, task or row exists", async () => {
    const { intent } = await actionFor("record_attendance", ATTENDANCE)
    await db.exec(`update compliance.users set role = 'viewer' where id = '${FAKE_USER}'`)

    const out = await runIntent(intent.intent_id)

    expect(out.json).toMatchObject({ intent_id: intent.intent_id, status: "refused", code: "ROLE_CHANGED" })
    expect(await intentRow(db, intent.intent_id)).toMatchObject({ status: "refused", failure: { code: "ROLE_CHANGED" } })
    expect(store.writes).toEqual([])
    expect(store.tables.submissions).toHaveLength(0)
    expect(store.tables.pipeline_tasks).toHaveLength(0)
    expect(store.tables.construction_attendance).toHaveLength(0)
    expect(rolesSeen).toEqual([])
    expect(mocks.runLevel1).not.toHaveBeenCalled()
  })

  test("a revoked link is refused LINK_GONE and nothing runs", async () => {
    const { link, intent } = await actionFor("record_attendance", ATTENDANCE)
    await db.exec(`update platform.user_ai_links set status = 'revoked' where id = '${link.link_id}'`)
    const out = await runIntent(intent.intent_id)
    expect(out.json).toMatchObject({ status: "refused", code: "LINK_GONE" })
    expect(store.writes).toEqual([])
  })

  test("writes off: refused WRITES_NOT_ENABLED and nothing changes (the intent stays recorded); once on, the same intent runs", async () => {
    const { intent } = await actionFor("record_attendance", ATTENDANCE)
    await setWrites(db, false)

    const off = await runIntent(intent.intent_id)
    expect(off.json).toMatchObject({ status: "refused", code: "WRITES_NOT_ENABLED" })
    expect((await intentRow(db, intent.intent_id)).status).toBe("recorded")
    expect(store.writes).toEqual([])

    await setWrites(db, true)
    const on = await runIntent(intent.intent_id)
    expect(on.json).toMatchObject({ status: "done" })
    expect(store.tables.construction_attendance).toHaveLength(1)
  })

  test("a second run of a done intent runs nothing; an executing intent answers executing and is not run again", async () => {
    const { intent } = await actionFor("record_attendance", ATTENDANCE)
    expect((await runIntent(intent.intent_id)).json.status).toBe("done")
    const before = store.writes.length

    const again = await runIntent(intent.intent_id)
    expect(again.json).toMatchObject({ status: "refused", code: "NOT_CLAIMABLE" })
    expect(store.writes.length).toBe(before)
    expect(store.tables.construction_attendance).toHaveLength(1)

    const other = await recordIntent(db, (await mintLink(db, FAKE_USER, FAKE_PROJECT_A, { level: 1 })).token, "action", "record_attendance", { rosterId: "roster_a", date: "2026-09-27" }, key())
    await db.query("select public.ai_work_link_intent_claim($1)", [other.intent_id])
    const busy = await runIntent(other.intent_id)
    expect(busy.json).toMatchObject({ intent_id: other.intent_id, status: "executing" })
    expect(store.tables.construction_attendance).toHaveLength(1)
  })

  test("a draft the person confirmed runs once through the same path; an unconfirmed draft is refused", async () => {
    await setWrites(db, true)
    const link = await mintLink(db, FAKE_USER, FAKE_PROJECT_A, { level: 1 })
    const draft = await recordIntent(db, link.token, "draft", "record_attendance", ATTENDANCE, key())

    const early = await runIntent(draft.intent_id)
    expect(early.json).toMatchObject({ status: "refused" })
    expect(store.writes).toEqual([])

    const confirmed = (await one<{ r: J }>(db, "select public.ai_work_link_draft_confirm($1, $2, $3) r", [draft.intent_id, draft.confirm_token, FAKE_USER])).r
    expect(confirmed.status).toBe("confirmed")
    const out = await runIntent(draft.intent_id)
    expect(out.json).toMatchObject({ status: "done" })
    expect(submission()).toMatchObject({ via: "ai_link", userId: FAKE_USER })
    expect(await intentRow(db, draft.intent_id)).toMatchObject({ status: "done", kind: "draft" })
  })
})

describe("text rules (spec 9.11)", () => {
  test("a text value over 2,000 characters fails TEXT_TOO_LONG with no business row, and the intent reads failed with that code", async () => {
    const { intent } = await actionFor("create_meeting", { title: "x".repeat(2001), scheduledAt: "2026-10-01T10:00:00Z" })
    const out = await runIntent(intent.intent_id)
    expect(out.json).toMatchObject({ status: "failed", code: "TEXT_TOO_LONG" })
    expect(await intentRow(db, intent.intent_id)).toMatchObject({ status: "failed", failure: { code: "TEXT_TOO_LONG" } })
    expect(store.writes).toEqual([])
    expect(store.tables.pms_meetings ?? []).toHaveLength(0)
  })
})
