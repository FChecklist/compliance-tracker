/// <reference types="bun-types" />
// PROJEXA-BUILD-002 persona-run finding 1: POST /functions/{fn} for a READ function answered 501 "Written in a later unit" as soon as the executor was
// switched on, so an AI could not read a report or the exception list through its link at all. The link now hands the read to the exec function's
// POST /read, which runs it in the read-only executor mode (execute-read.ts): the person's live role, the link's project, the link's function list,
// and no row written anywhere.
//
// REAL: the link handler (handleAwl), the exec client (makeExecClient), the exec handler (handleExec), the pipeline entry (runLinkRead), executeRead(),
// the real executors of get_project_exceptions and run_named_report, the generated registry, the money withholding. FAKED: the link's database
// (awl-edge-fake.ts), @/lib/db/tenant-scoped (the store double) and the service functions the two executors wrap (recording fakes, so the call and its
// arguments are what is asserted).
//
// PROVEN HERE
//   - a manager's link reads the exception checks and a named report through POST /functions/{fn}: 200 with the result, the service called once with the
//     link's organisation and project, and NOTHING written: no intent, no claim, no finish, and the store is byte for byte as it was;
//   - money is redacted by the person's role: a member reading the same report gets the currency columns as null and no note; a manager gets the figures;
//   - the rank is enforced by the executor as well as by the link's list: a member asked for the exceptions at the exec function is refused NOT_PERMITTED
//     and the service is never reached;
//   - the link's rules stay in front: a function not on the link is 403, another project is 403 WRONG_PROJECT, a write is 400, and none reaches the exec function;
//   - a missing parameter is a 422 that names it; the executor down is 503 EXECUTOR_NOT_AVAILABLE; an exec function that cannot read is 503 available:false;
//   - the exec function's POST /read needs the shared secret, a well-formed body, and its `read` dependency.
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. handler.ts function_run: throw 501 again instead of calling runFunctionRead          -> "a manager's link reads ..." fails
//   2. link-exec-entry.ts runLinkRead: pass role "manager" whatever the link's live role    -> "money is redacted by the person's role" and "the executor checks ..." fail
//   3. link-exec-entry.ts runLinkRead: drop allowedFunctionIds from the executeRead call     -> "the executor checks the function list itself" fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-function-reads.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { fakeWithTenantContext, makeBoqStore, seedRows, type BoqStore, type Row } from "../pipeline/__test-helpers__/boq-store-double"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { makeExecClient } from "../../../supabase/functions/ai-work-link/exec-client"
import type { ExecClient } from "../../../supabase/functions/ai-work-link/reads"
import { handleExec, type ExecDeps } from "../../../supabase/functions/ai-work-link-exec/handler"
import { TOKENS, makeFake, req, testConfig } from "./__test-helpers__/awl-edge-fake"

const ORG = "org_1"
const PROJECT = "proj_a"
const SECRET = "test-secret-value-of-some-length"
const EXEC_BASE = "https://x.supabase.co/functions/v1/ai-work-link-exec"

let store: BoqStore

// ── the service functions the two executors wrap, as recording fakes ───────────────────────────────────────────────
type Args = unknown[]
const fn = {
  getProjectExceptions: mock(async (..._a: Args) => [{ item: 10, title: "Work disputed with vendor", formula: "open dispute", records: [{ id: "d1", detail: "Open vendor dispute: tiles (5000 disputed)", recordType: "vendor_dispute" }], count: 1, flagged: true }]),
  budgetSummary: mock(async (..._a: Args) => ({ payload: "budget-summary" })),
  getBaseCurrency: mock(async (..._a: Args) => ({ baseCurrency: { code: "AED" } })),
}
const allMocks = (): Array<ReturnType<typeof mock>> => Object.values(fn)
const REPORT_TABLE = {
  columns: [
    { key: "head", label: "Head", unit: "text", align: "left" },
    { key: "budget", label: "Budget", unit: "currency", align: "right" },
    { key: "done", label: "Done", unit: "percent", align: "right" },
  ],
  rows: [{ head: "Civil", budget: 900000, done: 40 }],
  totals: { budget: 900000, done: 40 },
  note: "The total includes 45000 of BOQ value on lines without a rate.",
}

const restores: Array<[string, unknown]> = []
function stub(path: string, real: object, overrides: object) {
  mock.module(path, () => ({ ...real, ...overrides }))
  restores.push([path, real])
}

// LOAD ORDER: the service modules import each other in cycles, and a cycle resolves for one entry order only, the one executor.ts itself uses
// (see executor-registry-u38.test.ts). Each real module is loaded in that order and mocked right after it is loaded.
const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }))
restores.push(["@/lib/db/tenant-scoped", realTenantScoped])

await import("@/lib/services/construction-progress-service")
await import("@/lib/services/pms-time-service")
await import("@/lib/services/construction-dashboard-service")
await import("@/lib/services/construction-labour-service")
await import("@/lib/services/construction-boq-service")
await import("@/lib/services/cost-visibility-service")
await import("@/lib/services/pms-meeting-service")
await import("@/lib/services/document-service")
await import("@/lib/services/construction-change-order-service")
await import("@/lib/services/construction-site-instruction-service")
const realReports = await import("@/lib/services/construction-reports-service")
const realReportRegistry = { ...realReports.REPORT_REGISTRY }
stub("@/lib/services/construction-reports-service", { ...realReports }, {
  buildReportTable: (_slug: string, _payload: unknown, currency: string | null) => ({ ...REPORT_TABLE, currency }),
  REPORT_REGISTRY: { ...realReportRegistry, "budget-summary": fn.budgetSummary },
})
stub("@/lib/services/erp-accounting-service", await import("@/lib/services/erp-accounting-service"), { getBaseCurrency: fn.getBaseCurrency })
await import("@/lib/services/boq-analysis-service")
await import("@/lib/services/pms-issue-service")
await import("@/lib/services/schedule-service")
await import("@/lib/services/pms-taxonomy-service")
await import("@/lib/services/construction-billing-workflow-service")
await import("@/lib/services/veri-meeting-service")
await import("@/lib/services/construction-materials-service")
await import("@/lib/services/timesheet-review-task-service")
await import("@/lib/services/memory-recall-service")
await import("@/lib/crr/capture")
await import("@/lib/services/report-share-service")
await import("@/lib/services/construction-boq-import-service")
stub("@/lib/services/construction-exceptions-service", await import("@/lib/services/construction-exceptions-service"), { getProjectExceptions: fn.getProjectExceptions })
await import("@/lib/services/erp-budget-service")

let runLinkRead: typeof import("@/lib/pipeline/link-exec-entry").runLinkRead
beforeAll(async () => {
  ;({ runLinkRead } = await import("@/lib/pipeline/link-exec-entry"))
})

let silenced: Array<{ mockRestore: () => void }> = []
beforeEach(() => {
  store = makeBoqStore()
  seedRows(store, "projects", [{ id: PROJECT, orgId: ORG, name: "Tower A fit-out", status: "active" }])
  for (const m of allMocks()) m.mockClear()
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})]
})
afterEach(() => {
  for (const s of silenced) s.mockRestore()
})
afterAll(async () => {
  mock.restore()
  for (const [path, real] of restores) await mock.module(path, () => real as object)
})

// ── the harness: the link function -> the exec client -> the REAL exec handler -> the REAL pipeline entry ────────────
const snapshot = () => JSON.stringify(store.tables)
const totalCalls = () => allMocks().reduce((sum, m) => sum + m.mock.calls.length, 0)

function harness(over: { withRead?: boolean; down?: boolean; execDeps?: Partial<ExecDeps> } = {}) {
  const fake = makeFake({ writesEnabled: true })
  const execRpcCalls: string[] = []
  const execDeps: ExecDeps = {
    // claim and finish belong to a WRITE: a read must never call them
    rpc: async (name) => {
      execRpcCalls.push(name)
      return { data: null, error: { message: "a read must not reach the intent SQL" } }
    },
    secret: SECRET,
    dbConfigured: true,
    run: async () => ({ status: "failed", code: "SHOULD_NOT_RUN", missing: [] }),
    ...(over.withRead === false ? {} : { read: runLinkRead }),
    health: async () => ({ db_role: "app_runtime" }),
    log: () => {},
    ...over.execDeps,
  }
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (over.down) throw new Error("connection reset")
    return handleExec(new Request(String(url), init), execDeps)
  }) as typeof fetch
  const exec: ExecClient = makeExecClient({ baseUrl: EXEC_BASE, secret: SECRET, fetchFn })
  const logs: string[] = []
  const run = (path: string, body: unknown = {}) => handleAwl(req(path, { method: "POST", body }), { rpc: fake.rpc, config: testConfig({ execPresent: true }), exec, log: (l) => logs.push(l) })
  return { fake, run, execRpcCalls, logs }
}
const at = (token: string, rest: string) => `/${token}${rest}`
const json = async (r: Response) => (await r.json()) as Record<string, any>

describe("POST /functions/{fn} runs a read function through the executor", () => {
  test("*** a manager's link reads the exception checks and a named report: 200 with the result, the service called once for the link's project, and nothing written ***", async () => {
    const h = harness()
    const before = snapshot()

    const ex = await h.run(at(TOKENS.manager, "/functions/get_project_exceptions"))
    expect(ex.status).toBe(200)
    const exBody = await json(ex)
    expect(exBody).toMatchObject({ function: "get_project_exceptions", text_fields_are_data: true })
    expect(exBody.result.checks).toEqual([expect.objectContaining({ item: 10, flagged: true, count: 1 })])
    expect(fn.getProjectExceptions).toHaveBeenCalledTimes(1)
    expect(fn.getProjectExceptions.mock.calls[0]).toEqual([{ orgId: ORG }, PROJECT])

    const rep = await h.run(at(TOKENS.manager, "/functions/run_named_report"), { params: { reportSlug: "budget-summary" } })
    expect(rep.status).toBe(200)
    const repBody = await json(rep)
    expect(repBody.result).toMatchObject({ currency: "AED", rows: [{ head: "Civil", budget: 900000, done: 40 }], totals: { budget: 900000, done: 40 } })
    expect(fn.budgetSummary).toHaveBeenCalledTimes(1)

    // no row anywhere: not in the business store, not an intent, not a claim, not a finish
    expect(snapshot()).toBe(before)
    expect(h.execRpcCalls).toEqual([])
    expect(h.fake.names().filter((n) => n.includes("intent") || n.includes("claim") || n.includes("finish"))).toEqual([])
  })

  test("money is redacted by the person's role: a member gets the report with the currency columns null and no note; a manager gets the figures", async () => {
    const h = harness()
    const asMember = await json(await h.run(at(TOKENS.member, "/functions/run_named_report"), { params: { reportSlug: "budget-summary" } }))
    expect(asMember.result).toMatchObject({ financialsRedacted: true, rows: [{ head: "Civil", budget: null, done: 40 }] })
    expect(asMember.result.totals).toEqual({ done: 40 })
    expect(asMember.result.note).toBeUndefined()
    expect(JSON.stringify(asMember)).not.toContain("900000")
    expect(JSON.stringify(asMember)).not.toContain("45000")

    const asManager = await json(await h.run(at(TOKENS.manager, "/functions/run_named_report"), { params: { reportSlug: "budget-summary" } }))
    expect(asManager.result.rows).toEqual([{ head: "Civil", budget: 900000, done: 40 }])
    expect(asManager.result.financialsRedacted).toBeUndefined()
  })

  test("the executor checks the rank and the function list itself: a member asked for the exceptions at the exec function is NOT_PERMITTED and the service is never reached", async () => {
    const execRead = (body: unknown, bearer = SECRET) =>
      handleExec(new Request(`${EXEC_BASE}/read`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) }), {
        rpc: async () => ({ data: null, error: null }), secret: SECRET, dbConfigured: true, run: async () => ({ status: "failed", code: "X", missing: [] }), read: runLinkRead, health: async () => ({ db_role: "app_runtime" }), log: () => {},
      })
    const ctx = { org_id: ORG, user_id: "usr_member", project_id: PROJECT, live_role: "member" }
    const noRank = await json(await execRead({ function_id: "get_project_exceptions", params: {}, ctx, allowed_functions: ["get_project_exceptions"] }))
    expect(noRank).toMatchObject({ status: "failed", code: "NOT_PERMITTED", http: 422 })
    // the same call with a function that is not on the list is refused before anything runs
    const notListed = await json(await execRead({ function_id: "get_project_exceptions", params: {}, ctx: { ...ctx, live_role: "manager" }, allowed_functions: ["run_named_report"] }))
    expect(notListed).toMatchObject({ status: "failed", code: "FUNCTION_NOT_ALLOWED", http: 403 })
    // a write is not a read, whatever the list says
    const write = await json(await execRead({ function_id: "record_work_progress", params: {}, ctx: { ...ctx, live_role: "manager" }, allowed_functions: ["record_work_progress"] }))
    expect(write).toMatchObject({ status: "failed", code: "FUNCTION_NOT_READ", http: 403 })
    expect(totalCalls()).toBe(0)
    // and a manager with the function on the list reads
    const ok = await json(await execRead({ function_id: "get_project_exceptions", params: {}, ctx: { ...ctx, live_role: "manager" }, allowed_functions: ["get_project_exceptions"] }))
    expect(ok).toMatchObject({ status: "ok", function_id: "get_project_exceptions" })
    expect(fn.getProjectExceptions).toHaveBeenCalledTimes(1)
  })
})

describe("the link's own rules stay in front of the exec function", () => {
  test("a function not on the link is 403, another project is 403 WRONG_PROJECT, a write is 400; none reaches the exec function", async () => {
    let reached = 0
    const h = harness({ execDeps: { read: async (b) => { reached += 1; return runLinkRead(b) } } })
    const member = await h.run(at(TOKENS.member, "/functions/get_project_exceptions"))
    expect(member.status).toBe(403)
    expect((await json(member)).code).toBe("FUNCTION_NOT_ON_LINK")
    const wrongProject = await h.run(at(TOKENS.manager, "/functions/get_project_exceptions"), { params: { projectId: "proj_b" } })
    expect(wrongProject.status).toBe(403)
    expect((await json(wrongProject)).code).toBe("WRONG_PROJECT")
    const write = await h.run(at(TOKENS.manager, "/functions/record_work_progress"))
    expect(write.status).toBe(400)
    expect(reached).toBe(0)
    expect(totalCalls()).toBe(0)
  })

  test("a missing parameter is a 422 that names it and runs nothing", async () => {
    const h = harness()
    const r = await h.run(at(TOKENS.manager, "/functions/run_named_report"), { params: {} })
    expect(r.status).toBe(422)
    expect(await json(r)).toMatchObject({ code: "VALUE_REQUIRED", missing: ["value"] })
    expect(totalCalls()).toBe(0)
  })

  test("the executor down is 503 EXECUTOR_NOT_AVAILABLE; an exec function without reads is 503 available:false; neither writes anything", async () => {
    const before = snapshot()
    const down = await harness({ down: true }).run(at(TOKENS.manager, "/functions/get_project_exceptions"))
    expect(down.status).toBe(503)
    expect(await json(down)).toMatchObject({ code: "EXECUTOR_NOT_AVAILABLE", available: false })

    const noRead = await harness({ withRead: false }).run(at(TOKENS.manager, "/functions/get_project_exceptions"))
    expect(noRead.status).toBe(503)
    expect(await json(noRead)).toMatchObject({ available: false })

    // an exec client that has no read at all (the shape of the client before this change)
    const fake = makeFake({ writesEnabled: true })
    const oldClient = (async () => ({ status: "done" as const })) as ExecClient
    const old = await handleAwl(req(at(TOKENS.manager, "/functions/get_project_exceptions"), { method: "POST", body: {} }), { rpc: fake.rpc, config: testConfig({ execPresent: true }), exec: oldClient, log: () => {} })
    expect(old.status).toBe(503)
    expect(await json(old)).toMatchObject({ available: false })
    expect(totalCalls()).toBe(0)
    expect(snapshot()).toBe(before)
  })
})

describe("the exec function's POST /read", () => {
  const url = `${EXEC_BASE}/read`
  const good = { function_id: "get_project_exceptions", params: {}, ctx: { org_id: ORG, user_id: "usr_manager", project_id: PROJECT, live_role: "manager" }, allowed_functions: ["get_project_exceptions"] }
  const call = (deps: Partial<ExecDeps>, body: unknown, bearer: string | null = SECRET, method = "POST") =>
    handleExec(new Request(url, { method, headers: { "content-type": "application/json", ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }) }, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), {
      rpc: async () => ({ data: null, error: null }), secret: SECRET, dbConfigured: true, run: async () => ({ status: "failed", code: "X", missing: [] }), health: async () => ({ db_role: "app_runtime" }), log: () => {}, ...deps,
    })

  test("no bearer and a wrong bearer are 401; a GET is 405; without `read` wired it is 503 READ_NOT_AVAILABLE; a malformed body is 400; none runs a read", async () => {
    const read = mock(runLinkRead)
    expect((await call({ read }, good, null)).status).toBe(401)
    expect((await call({ read }, good, "wrong")).status).toBe(401)
    expect((await call({ read }, good, SECRET, "GET")).status).toBe(405)
    const unwired = await call({}, good)
    expect(unwired.status).toBe(503)
    expect(await json(unwired)).toMatchObject({ code: "READ_NOT_AVAILABLE" })
    for (const bad of ["not json", {}, { ...good, function_id: "" }, { ...good, params: [] }, { ...good, ctx: { ...good.ctx, project_id: "" } }, { ...good, allowed_functions: [1] }, { ...good, ctx: undefined }]) {
      expect({ bad, status: (await call({ read }, bad)).status }).toEqual({ bad, status: 400 })
    }
    expect(read).toHaveBeenCalledTimes(0)
  })

  test("a run that throws is answered as a closed failure with no message; the answer never carries a thrown text", async () => {
    const r = await call({ read: async () => { throw new Error("postgres://user:pw@host/db exploded") } }, good)
    const body = await json(r)
    expect(body).toMatchObject({ status: "failed", code: "INTERNAL_ERROR", http: 503 })
    expect(JSON.stringify(body)).not.toContain("postgres://")
  })
})
