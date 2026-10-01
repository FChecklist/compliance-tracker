/// <reference types="bun-types" />
// PROJEXA USER-WIDE AI WORK LINK (drizzle/0668), step 2: "Create New Project" end to end, from the person's link to the project that exists. Everything on the
// path is REAL except the two database halves, which are what the other write tests use:
//   * the INTENT side is the real SQL on PGlite (0618, 0621 to 0631, 0651, 0668, 0669): the user link, the draft, the confirm, the claim, the finish
//   * the BUSINESS side is the fake tenant database of src/lib/pipeline/fake-tenant-db.ts (it compiles the REAL drizzle where clauses and records every write)
//   * the Edge function (handler.ts, drafts.ts, confirm.ts), the exec function (handler.ts of ai-work-link-exec), the pipeline (link-exec-entry.ts, runDirectTask, the
//     create_project executor and createProject()) are the real code
// WHAT IS PROVEN: the person mints a link, the AI drafts create_project with no project, NOTHING is made before the click, the person confirms signed in, exactly ONE
// project is made in the link's organisation with the person as its lead, the intent records the new project's id, the AI is told the id and continues in the project
// through /projects/{id}/..., and the guards hold: a project link cannot make a project, a viewer cannot, a person demoted before the click makes nothing, a second
// click makes nothing more, writes off makes nothing.
// Run: bun test --isolate src/lib/services/ai-work-link-user-link-create-project.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleExec, type ExecDeps } from "../../../supabase/functions/ai-work-link-exec/handler"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { parseExecAnswer } from "../../../supabase/functions/ai-work-link/exec-client"
import type { ExecClient } from "../../../supabase/functions/ai-work-link/reads"
import type { FakeStore } from "@/lib/pipeline/fake-tenant-db"
import { createFakeStore } from "@/lib/pipeline/fake-tenant-db"
import { AUTH, F, makeHarness, one, openMintDb, type Harness, type J } from "./__test-helpers__/awl-mint-harness"
import { forwardSql } from "./__test-helpers__/awl-pglite"
import { execTables, installExecMocks, type ExecMocks } from "./__test-helpers__/awl-exec-fixture"
import { rpcFor, setWrites } from "./__test-helpers__/awl-write-fixture"

setDefaultTimeout(120_000)

const SECRET = "test-secret-value-of-some-length"
const ORG = "org-a"
const config = { ...configFromEnv(() => undefined), confirmHost: "inbox-test.pages.dev", execPresent: true }

let db: PGlite
let h: Harness
let store: FakeStore
let mocks: ExecMocks
let runLinkIntent: typeof import("@/lib/pipeline/link-exec-entry").runLinkIntent
let silenced: Array<{ mockRestore: () => void }> = []

/** The business tables: the organisation's one product, the member who will confirm, and nothing else the run needs. */
function freshStore(): FakeStore {
  const t = execTables()
  return createFakeStore({
    ...t,
    products: [{ id: "prod", orgId: ORG, name: "Interiors", isActive: true }, { id: "prod-b", orgId: "org-b", name: "Tower work", isActive: true }],
    projects: [],
    users: [{ id: "u-mem", orgId: ORG, isActive: true, role: "member", name: "Mo Member", email: "mo@a.example.test" }],
  })
}

beforeAll(async () => {
  mocks = await installExecMocks(() => store)
  ;({ runLinkIntent } = await import("@/lib/pipeline/link-exec-entry"))
  db = await openMintDb()
  for (const name of ["0629_build001_awl_execution_sql", "0630_build001_awl_submissions_via", "0651_build002_awl_seed_submit_timesheet", "0668_awl_user_wide_link", "0669_awl_seed_user_link_create_project"]) await db.exec(forwardSql(name))
  h = await makeHarness(db)
}, 240_000)
afterAll(async () => {
  await mocks.restore()
  await db.close()
})
beforeEach(async () => {
  store = freshStore()
  h.reset()
  mocks.runLevel1.mockClear()
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})]
  await db.exec("update platform.user_ai_links set status = 'revoked', created_at = created_at - interval '3 days'")
  await db.exec("update platform.ai_work_link_intent set created_at = created_at - interval '3 days' where created_at > now() - interval '1 day'")
  await db.exec("update compliance.users set role = 'member' where id = 'u-mem'")
})
afterEach(async () => {
  for (const s of silenced) s.mockRestore()
  await setWrites(db, false)
})

/** The in-process exec client: the same handler the ai-work-link-exec function serves, over the same pipeline, as the link function calls it. */
const execClient: ExecClient = async (intentId) => {
  const deps: ExecDeps = { rpc: rpcFor(db), secret: SECRET, dbConfigured: true, run: runLinkIntent, health: async () => ({ db_role: "app_runtime" }), log: () => {} }
  const res = await handleExec(new Request("https://x.supabase.co/functions/v1/ai-work-link-exec/run", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ intent_id: intentId }) }), deps)
  const out = parseExecAnswer(await res.json())
  if (!out) throw new Error("exec answered an unknown shape")
  return out
}

const call = (method: string, path: string, o: Parameters<Harness["call"]>[2] = {}) => h.call(method, path, { config, exec: execClient, ...o })

async function userLink(sub = AUTH.mem): Promise<string> {
  const r = await call("POST", "/user-link", { token: await h.sign({ sub }), body: {} })
  expect(r.res.status).toBe(201)
  return r.json.token as string
}

/** The draft of a new project: its id and the one-time confirm code, read from the confirm address exactly as the person's page reads it. */
async function draftProject(token: string, params: Record<string, unknown> = { name: "Marina Club", description: "Clubhouse" }): Promise<{ id: string; code: string; json: J }> {
  const r = await call("POST", `/${token}/drafts`, { body: { function: "create_project", params } })
  expect(r.res.status).toBe(201)
  const m = /#d=([A-Za-z0-9]+)\.([0-9a-f]{64})$/.exec(String(r.json.confirm_url))
  expect(m).not.toBeNull()
  return { id: m![1], code: m![2], json: r.json }
}

const confirm = async (draftId: string, code: string, sub = AUTH.mem) => call("POST", `/drafts/${draftId}/confirm`, { token: await h.sign({ sub }), body: { confirmToken: code } })
const projectsMade = () => store.tables.projects as Array<Record<string, any>>

describe("the whole path, in order", () => {
  test("list, draft with no project, NOTHING made before the click, confirm, ONE project with the person as lead, the intent records its id, the AI continues in it", async () => {
    await setWrites(db, true)
    const token = await userLink()

    // 1. the AI lists the person's projects: the numbered list and the two options after it
    const list = await call("GET", `/${token}/projects`, { headers: { accept: "application/json" } })
    expect(list.json.projects.map((p: J) => p.name).sort()).toEqual(["Villa A", "Villa A2"])
    expect(list.json.extra_options.map((o: J) => [o.n, o.label])).toEqual([[3, "Report on all above"], [4, "Create New Project"]])

    // 2. the AI drafts the project: no project in the address, no project in the intent
    const d = await draftProject(token)
    expect(d.json).toMatchObject({ kind: "draft", function: "create_project", status: "awaiting_confirmation" })
    expect(await one<J>(db, "select project_id, org_id, user_id, function_id, status, params from platform.ai_work_link_intent where id = $1", [d.id])).toMatchObject({
      project_id: null, org_id: ORG, user_id: "u-mem", function_id: "create_project", status: "awaiting_confirmation", params: { name: "Marina Club", description: "Clubhouse" },
    })

    // 3. NOTHING is made yet: the draft changes nothing until the person confirms it
    expect(projectsMade()).toEqual([])
    expect(store.writes).toEqual([])
    const waiting = await call("GET", `/${token}/drafts/${d.id}`, { headers: { accept: "application/json" } })
    expect(waiting.json).toMatchObject({ status: "awaiting_confirmation" })
    expect(waiting.json.project).toBeUndefined()

    // 4. the person confirms, signed in: the exec function claims, runs and finishes it
    const done = await confirm(d.id, d.code)
    expect(done.res.status).toBe(200)
    expect(done.json).toMatchObject({ status: "done", function_id: "create_project", message: expect.stringContaining("new project is created") })
    const newId = done.json.project_id as string
    expect(typeof newId).toBe("string")
    expect(done.json.record).toMatchObject({ id: newId, route: "/dashboard/project" })

    // 5. exactly ONE project, in the link's organisation, in the organisation's product, the person its lead, named as drafted, attributed to the link
    expect(projectsMade()).toHaveLength(1)
    expect(projectsMade()[0]).toMatchObject({ id: newId, orgId: ORG, productId: "prod", name: "Marina Club", description: "Clubhouse", leadUserId: "u-mem" })
    expect(store.writes.filter((w) => w === "insert:projects")).toHaveLength(1)
    const sub = store.tables.submissions[0] as Record<string, any>
    expect(sub).toMatchObject({ via: "ai_link", userId: "u-mem", orgId: ORG, status: "done", modelCalls: 0 })
    expect(mocks.runLevel1).not.toHaveBeenCalled()

    // 6. the intent records the new project's id
    expect(await one<J>(db, "select status, result, project_id, submission_id from platform.ai_work_link_intent where id = $1", [d.id])).toMatchObject({
      status: "done", result: { id: newId, route: "/dashboard/project" }, project_id: null, submission_id: sub.id,
    })

    // 7. the AI reads the draft: it is told the new project's id and where to continue
    const status = await call("GET", `/${token}/drafts/${d.id}`, { headers: { accept: "application/json" } })
    expect(status.json).toMatchObject({ status: "done", project: { id: newId }, continue_at: `${F}/${token}/projects/${newId}/context`, result: { id: newId } })

    // 8. the project is in the organisation's data now (the two halves are one database live; here the row is copied across) and the AI continues in it
    await db.query("insert into compliance.projects (id, product_id, org_id, name, lead_user_id) values ($1, 'prod', $2, 'Marina Club', 'u-mem')", [newId, ORG])
    const ctx = await call("GET", `/${token}/projects/${newId}/context`, { headers: { accept: "application/json" } })
    expect(ctx.res.status).toBe(200)
    expect(ctx.json).toMatchObject({ scope: "user", project: { id: newId, name: "Marina Club" }, level: 0 })
    expect(ctx.json.allowed_functions).not.toContain("create_project")
    const after = await call("GET", `/${token}/projects`, { headers: { accept: "application/json" } })
    expect(after.json.projects.map((p: J) => p.name)).toContain("Marina Club")
    expect(after.json.projects.find((p: J) => p.name === "Marina Club")).toMatchObject({ lead: true })
    // and inside it the AI can draft a change of that project, recorded against it
    const inside = await call("POST", `/${token}/projects/${newId}/drafts`, { body: { function: "record_work_progress", params: { itemCode: "EX-01", percent: 5 } } })
    expect(inside.res.status).toBe(201)
    expect((await one<J>(db, "select project_id from platform.ai_work_link_intent where id = $1", [inside.json.draft_id])).project_id).toBe(newId)
  })

  test("a second click on the same confirm link makes nothing more: still exactly one project", async () => {
    await setWrites(db, true)
    const token = await userLink()
    const d = await draftProject(token)
    expect((await confirm(d.id, d.code)).json.status).toBe("done")
    const again = await confirm(d.id, d.code)
    expect(again.res.status).toBe(409)
    expect(again.json.code).toBe("CONFIRM_ALREADY_USED")
    expect(projectsMade()).toHaveLength(1)
  })

  test("with writes switched off the draft waits: the confirm says so, nothing is made, and the draft stays", async () => {
    const token = await userLink()
    const d = await draftProject(token)
    const c = await confirm(d.id, d.code)
    expect(c.res.status).toBe(503)
    expect(c.json.code).toBe("WRITES_NOT_ENABLED")
    expect(projectsMade()).toEqual([])
    expect((await one<J>(db, "select status from platform.ai_work_link_intent where id = $1", [d.id])).status).toBe("awaiting_confirmation")
  })

  test("another person cannot confirm it (NOT_YOUR_DRAFT) and a wrong code is not valid: nothing is made", async () => {
    await setWrites(db, true)
    const token = await userLink()
    const d = await draftProject(token)
    const other = await confirm(d.id, d.code, AUTH.mgr)
    expect(other.res.status).toBe(403)
    expect(other.json.code).toBe("NOT_YOUR_DRAFT")
    const wrong = await confirm(d.id, "0".repeat(64))
    expect(wrong.res.status).toBe(409)
    expect(projectsMade()).toEqual([])
  })
})

describe("the guards", () => {
  test("a link for ONE project cannot draft a new project; a viewer's user link cannot either; nothing is recorded", async () => {
    await setWrites(db, true)
    const proj = await call("POST", "/mint", { token: await h.sign({ sub: AUTH.mem }), body: { projectId: "proj-a" } })
    expect(proj.res.status).toBe(201)
    const r = await call("POST", `/${proj.json.token}/drafts`, { body: { function: "create_project", params: { name: "Nope" } } })
    expect(r.res.status).toBe(403)
    expect(r.json.code).toBe("FUNCTION_NOT_ON_LINK")
    const viewerLink = await userLink(AUTH.view)
    const v = await call("POST", `/${viewerLink}/drafts`, { body: { function: "create_project", params: { name: "Nope" } } })
    expect(v.res.status).toBe(403)
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_intent where function_id = 'create_project' and created_at > now() - interval '1 day'")).n).toBe(0)
    expect(projectsMade()).toEqual([])
  })

  test("a person demoted to viewer before the click: the confirm succeeds but the claim refuses (ROLE_CHANGED) and no project is made", async () => {
    await setWrites(db, true)
    const token = await userLink()
    const d = await draftProject(token)
    await db.exec("update compliance.users set role = 'viewer' where id = 'u-mem'")
    const c = await confirm(d.id, d.code)
    expect(c.res.status).toBe(200)
    expect(c.json).toMatchObject({ status: "refused", code: "ROLE_CHANGED" })
    expect(projectsMade()).toEqual([])
    expect(store.writes).toEqual([])
    expect((await one<J>(db, "select status, failure from platform.ai_work_link_intent where id = $1", [d.id])).status).toBe("refused")
  })

  test("the link revoked before the click: LINK_GONE, nothing is made", async () => {
    await setWrites(db, true)
    const token = await userLink()
    const d = await draftProject(token)
    await db.exec("update platform.user_ai_links set status = 'revoked' where scope = 'user' and user_id = 'u-mem' and status = 'active'")
    const c = await confirm(d.id, d.code)
    expect(c.json).toMatchObject({ status: "refused", code: "LINK_GONE" })
    expect(projectsMade()).toEqual([])
  })

  test("a product of another organisation is never used: with two products and none named the run fails VALUE_REQUIRED and names what to pick; a foreign productId is not found", async () => {
    await setWrites(db, true)
    store.tables.products = [...(store.tables.products as any[]), { id: "prod-2", orgId: ORG, name: "Fit-out", isActive: true }]
    const token = await userLink()
    const none = await draftProject(token, { name: "Two products" })
    const c1 = await confirm(none.id, none.code)
    expect(c1.json).toMatchObject({ status: "failed", code: "VALUE_REQUIRED" })
    const foreign = await draftProject(token, { name: "Wrong product", productId: "prod-b" })
    const c2 = await confirm(foreign.id, foreign.code)
    expect(c2.json.status).toBe("failed")
    expect(projectsMade()).toEqual([])
    const ok = await draftProject(token, { name: "Right product", productId: "prod-2" })
    expect((await confirm(ok.id, ok.code)).json.status).toBe("done")
    expect(projectsMade()).toHaveLength(1)
    expect(projectsMade()[0]).toMatchObject({ orgId: ORG, productId: "prod-2" })
  })

  test("the exec function refuses a claim with no project for any function but create_project (the project pin holds for every other function)", async () => {
    const deps: ExecDeps = {
      rpc: async (fn) => (fn === "ai_work_link_intent_claim"
        ? { data: { status: "ok", intent: { id: "i1", kind: "draft", function_id: "record_work_progress", params: {} }, ctx: { link_id: "l1", org_id: ORG, user_id: "u-mem", project_id: null, live_role: "member" } }, error: null }
        : { data: {}, error: null }),
      secret: SECRET, dbConfigured: true, run: runLinkIntent, health: async () => ({ db_role: "x" }), log: () => {},
    }
    const res = await handleExec(new Request("https://x.supabase.co/functions/v1/ai-work-link-exec/run", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ intent_id: "i1" }) }), deps)
    expect(res.status).toBe(503)
    expect(((await res.json()) as J).code).toBe("CLAIM_UNAVAILABLE")
    expect(store.writes).toEqual([])
    // and the pipeline entry itself refuses it, whoever calls it
    expect(await runLinkIntent({ intent: { id: "i1", kind: "draft", function_id: "record_work_progress", params: {} }, ctx: { link_id: "l1", org_id: ORG, user_id: "u-mem", project_id: null, live_role: "member" } })).toMatchObject({ status: "failed", code: "BAD_CLAIM" })
    // create_project INSIDE a project is refused too: it would pin the run to that project
    expect(await runLinkIntent({ intent: { id: "i2", kind: "draft", function_id: "create_project", params: { name: "x" } }, ctx: { link_id: "l1", org_id: ORG, user_id: "u-mem", project_id: "proj-a", live_role: "member" } })).toMatchObject({ status: "failed", code: "BAD_CLAIM" })
    expect(store.writes).toEqual([])
  })
})
