/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST SYNC, PUSH SIDE (drizzle/0681): a write a LAPTOP pushed, run through the REAL exec handler (POST /sync-run of the ai-work-link-exec Edge function), the REAL pipeline
// (link-exec-entry runSyncOp -> runLinkIntent -> runDirectTask -> validate -> the executors) against the fake tenant database. The decisions BEFORE the write (the registered function, the role,
// the project, the version, the ledger) are projexa-sync-push.pglite.test.ts's; what is proven here is that the write itself is the SAME write the AI work link makes:
//   attribution  the record lands in the PERSON's name (submissions.user_id), as a direct task, executor `ai`, model_calls 0; the provenance label is `px-sync:<device>`
//   no model     the Level 1 lane never runs; the memory row is written WITHOUT an embedding
//   role         the role handed to the executor is the person's LIVE role (what projexa-sync resolved), never a constant
//   project pin  a parameter that names another project is refused before any write
//   guards       an unknown function, or one with no executor, is FUNCTION_NOT_AVAILABLE with no business row; text over 2,000 characters is TEXT_TOO_LONG
//   closed       a failure is a code and the names of what is missing, never a message
//   http         bad secret 401, not configured 503, wrong method 405, malformed body 400, no sync runner 503
// Run: bun test --isolate src/lib/services/ai-work-link-sync-run.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test"
import { handleExec, type ExecDeps } from "../../../supabase/functions/ai-work-link-exec/handler"
import type { FakeStore } from "@/lib/pipeline/fake-tenant-db"
import { FAKE_ORG, FAKE_PROJECT_A, FAKE_PROJECT_B, FAKE_USER, freshStore, installExecMocks, type ExecMocks } from "./__test-helpers__/awl-exec-fixture"

setDefaultTimeout(60_000)

type J = Record<string, any>
const SECRET = "test-secret-value-of-some-length"
const DEVICE = "laptop-test-0001"
let store: FakeStore = freshStore()
let mocks: ExecMocks
let runSyncOp: typeof import("@/lib/pipeline/link-exec-entry").runSyncOp
let rolesUsed: Array<string | null | undefined> = []
let restoreExecutor: () => Promise<void> = async () => {}
let silenced: Array<{ mockRestore: () => void }> = []

beforeAll(async () => {
  mocks = await installExecMocks(() => store)
  const realExecutor = await import("@/lib/pipeline/executor")
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
  ;({ runSyncOp } = await import("@/lib/pipeline/link-exec-entry"))
}, 120_000)
afterAll(async () => {
  await restoreExecutor()
  await mocks.restore()
})
beforeEach(() => {
  store = freshStore()
  mocks.runLevel1.mockClear()
  mocks.createMemoryRecord.mockClear()
  rolesUsed = []
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})]
})
afterEach(() => {
  for (const s of silenced) s.mockRestore()
})

const execDeps = (over: Partial<ExecDeps> = {}): ExecDeps => ({
  rpc: async () => {
    throw new Error("sync-run must never touch the intent tables")
  },
  secret: SECRET,
  dbConfigured: true,
  run: async () => ({ status: "failed", code: "NOT_USED", missing: [] }),
  syncRun: (b) => runSyncOp(b),
  health: async () => ({ db_role: "app_runtime" }),
  log: () => {},
  ...over,
})

const ATTENDANCE = { rosterId: "roster_a", date: "2026-09-26" }
const body = (over: Record<string, unknown> = {}, ctx: Record<string, unknown> = {}) => ({
  op_id: "op-sync-0001",
  function_id: "record_attendance",
  params: ATTENDANCE,
  ctx: { org_id: FAKE_ORG, user_id: FAKE_USER, project_id: FAKE_PROJECT_A, live_role: "manager", device_id: DEVICE, ...ctx },
  ...over,
})
async function syncRun(b: unknown, deps: ExecDeps = execDeps(), o: { secret?: string | null; method?: string } = {}): Promise<{ status: number; json: J }> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (o.secret !== null) headers.authorization = `Bearer ${o.secret ?? SECRET}`
  const method = o.method ?? "POST"
  const res = await handleExec(new Request("https://x.supabase.co/functions/v1/ai-work-link-exec/sync-run", { method, headers, body: method === "GET" ? undefined : JSON.stringify(b) }), deps)
  return { status: res.status, json: (await res.json()) as J }
}
const submission = () => store.tables.submissions[0] as Record<string, any>
const task = () => store.tables.pipeline_tasks[0] as Record<string, any>

describe("the write is the AI link's write, as the person", () => {
  test("lands in the person's name: a direct task, executor ai, model_calls 0, provenance px-sync:<device>, the record created, the answer is the record's id and route", async () => {
    const out = await syncRun(body())
    expect(out.status).toBe(200)
    expect(out.json).toMatchObject({ op_id: "op-sync-0001", status: "done" })
    expect(typeof out.json.record.id).toBe("string")
    expect(out.json.record.route).toMatch(/^\//)
    expect(store.tables.submissions).toHaveLength(1)
    expect(submission()).toMatchObject({ via: "ai_link", aiLinkId: `px-sync:${DEVICE}`, userId: FAKE_USER, orgId: FAKE_ORG, projectId: FAKE_PROJECT_A, status: "done", modelCalls: 0, level1Outcome: "not_needed" })
    expect(String(submission().rawInput)).toContain("op-sync-0001")
    expect(task()).toMatchObject({ executor: "ai", functionId: "record_attendance", status: "done" })
    expect(store.tables.construction_attendance.map((r) => r.rosterId)).toEqual(["roster_a"])
    expect(out.json.submission_id).toBe(submission().id)
  })

  test("no model is called and the memory row is stored without an embedding", async () => {
    await syncRun(body())
    expect(mocks.runLevel1).not.toHaveBeenCalled()
    expect(mocks.createMemoryRecord).toHaveBeenCalledTimes(1)
    expect(mocks.createMemoryRecord.mock.calls[0][2]).toMatchObject({ skipEmbedding: true })
  })

  test("the role handed to the executor is the person's LIVE role, whatever it is", async () => {
    await syncRun(body({}, { live_role: "member" }))
    expect(rolesUsed).toEqual(["member"])
    rolesUsed = []
    store = freshStore()
    await syncRun(body({ op_id: "op-sync-0002" }, { live_role: "senior_professional" }))
    expect(rolesUsed).toEqual(["senior_professional"])
  })
})

describe("what the pipeline still refuses", () => {
  test("a parameter that names another project is refused before any write (the project pin)", async () => {
    const out = await syncRun(body({ params: { ...ATTENDANCE, projectId: FAKE_PROJECT_B } }))
    expect(out.status).toBe(200)
    expect(out.json.status).toBe("failed")
    expect(out.json.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    expect(store.tables.construction_attendance ?? []).toHaveLength(0)
  })

  test("an unknown function, and one with no executor, are FUNCTION_NOT_AVAILABLE with no business row", async () => {
    for (const fn of ["no_such_function", "list_projects"]) {
      store = freshStore()
      const out = await syncRun(body({ function_id: fn }))
      expect(out.json).toMatchObject({ status: "failed", code: "FUNCTION_NOT_AVAILABLE" })
      expect(store.tables.submissions ?? []).toHaveLength(0)
    }
  })

  test("text over 2,000 characters is TEXT_TOO_LONG and writes nothing (a laptop must hold the same limit)", async () => {
    const out = await syncRun(body({ function_id: "create_meeting", params: { title: "x".repeat(2001), scheduledAt: "2026-10-01T10:00:00Z" } }))
    expect(out.json).toMatchObject({ status: "failed", code: "TEXT_TOO_LONG" })
    expect(store.tables.pms_meetings ?? []).toHaveLength(0)
  })

  test("a failure answers a closed code and the names of what is missing, never a message", async () => {
    const out = await syncRun(body({ params: { date: "2026-09-26" } })) // no rosterId
    expect(out.json.status).toBe("failed")
    expect(Object.keys(out.json).sort()).toEqual(["code", "missing", "op_id", "status"])
    expect(out.json.missing).toContain("rosterId")
  })
})

describe("http", () => {
  test("a wrong or missing secret is 401 and nothing runs", async () => {
    expect((await syncRun(body(), execDeps(), { secret: "wrong-secret-value-of-some-length" })).status).toBe(401)
    expect((await syncRun(body(), execDeps(), { secret: null })).status).toBe(401)
    expect(store.tables.submissions ?? []).toHaveLength(0)
  })

  test("not configured is 503 NOT_CONFIGURED; no sync runner is 503 SYNC_NOT_AVAILABLE; a wrong method is 405", async () => {
    expect((await syncRun(body(), execDeps({ secret: undefined }))).json).toMatchObject({ code: "NOT_CONFIGURED" })
    expect((await syncRun(body(), execDeps({ dbConfigured: false }))).status).toBe(503)
    const none = await syncRun(body(), execDeps({ syncRun: undefined }))
    expect(none.status).toBe(503)
    expect(none.json.code).toBe("SYNC_NOT_AVAILABLE")
    expect((await syncRun(body(), execDeps(), { method: "GET" })).status).toBe(405)
  })

  test("a malformed body is 400 BAD_REQUEST and nothing runs", async () => {
    const bad: unknown[] = [
      body({ op_id: "has space" }),
      body({ function_id: "bad function!" }),
      body({ params: [1] }),
      body({ params: null }),
      body({}, { device_id: "x" }),
      body({}, { org_id: "" }),
      body({}, { project_id: null }), // only create_project may have no project
      body({ function_id: "create_project", params: { name: "x" } }, { project_id: FAKE_PROJECT_A }), // and create_project must have none
      { ...body(), ctx: null },
      "text",
      body({ params: { big: "x".repeat(80_000) } }),
    ]
    for (const b of bad) expect((await syncRun(b)).status).toBe(400)
    expect(store.tables.submissions ?? []).toHaveLength(0)
  })

  test("a throw inside the run is answered as a closed INTERNAL_ERROR, never the thrown text", async () => {
    const out = await syncRun(body(), execDeps({ syncRun: async () => { throw new Error("postgres://user:secret@host/db exploded") } }))
    expect(out.status).toBe(200)
    expect(out.json).toEqual({ op_id: "op-sync-0001", status: "failed", code: "INTERNAL_ERROR", missing: [] })
    expect(JSON.stringify(out.json)).not.toContain("postgres")
  })
})
