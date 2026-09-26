/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-29 / U-47, register row BR-424 (paste-back fallback of surface 1). POST
// /api/v1/projexa/projects/[id]/paste-back with a valid fenced JSON block, under the signed-in user's session, stores
// 1 proposal that the approvals route (BR-409) lists and writes 0 BOQ line-item rows; a block that fails the
// function registry's schema answers 422 and stores 0 proposals.
//
// Each of these is read from the store after the call, not from the response:
//   - the stored row is a pending compliance.submissions row of this project, under the person, whose selected_chain is
//     { source: "paste_back", functionId, params, note }; no BOQ, line item, task, pipeline task or audit row exists;
//   - GET .../approvals lists exactly that proposal, and approving it (the BR-410 route) writes the line item, so the
//     pasted proposal is the same object the approval list works on;
//   - every refusal (unknown function, a function the list does not approve, a missing title, another project, a bad
//     line item, text that is not a fenced JSON block, an unsupported version, too many blocks) answers 422 and leaves
//     every table byte for byte as it was;
//   - a paste is all or nothing: a valid block beside an invalid one stores nothing;
//   - a key that names no person is refused (400), and another organisation's project, or a project a project-pinned
//     key may not reach, is a 404 that stores nothing.
//
// WHAT IS REAL: the route, prepared-proposals.ts, the registry's validate(), function-registry.ts, the BOQ service's
// line-item validators, the approvals route, run-submission.ts (runDirectTask), executor.ts, createBoq(), logActivity,
// requireRoleOrScope and requireActingPerson (session path). WHAT IS FAKED: @/lib/db/tenant-scoped, by
// src/lib/pipeline/__test-helpers__/boq-store-double.ts, requireAuthOrApiKey (the identity), and, in two tests,
// requireActingPerson (a key plus a person).
//
// Run: bun test --isolate "src/app/api/v1/projexa/projects/[id]/paste-back/route.test.ts"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "@/lib/pipeline/__test-helpers__/boq-store-double"

const ORG = "org_1"
const OTHER_ORG = "org_2"
const PROJECT_A = "project_a"
const PROJECT_B = "project_b"
const PROJECT_OTHER_ORG = "project_x"
const PERSON = "person_1"
const KEY_ID = "key_1"

let store: BoqStore
let identity: { dbUser: Record<string, unknown> | null; apiKey: Record<string, unknown> | null }
let stubActing: { person: Record<string, unknown>; actor: Record<string, unknown> } | null = null

const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }))

const realAuthGuard = await import("@/lib/supabase/auth-guard")
// Captured before the mock is installed: mock.module replaces the module in place.
const realRequireActingPerson = realAuthGuard.requireActingPerson
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => ({ orgId: ORG, response: null, ...identity })),
  requireActingPerson: async (request: Request, ctx: never, body?: unknown) =>
    stubActing ? { acting: stubActing, error: null } : realRequireActingPerson(request, ctx, body),
}))

type RouteFn = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let paste: RouteFn
let approvalsGET: RouteFn
let approvalsPOST: RouteFn
beforeAll(async () => {
  ;({ POST: paste } = (await import("./route")) as unknown as { POST: RouteFn })
  ;({ GET: approvalsGET, POST: approvalsPOST } = (await import("@/app/api/v1/projexa/projects/[id]/approvals/route")) as unknown as { GET: RouteFn; POST: RouteFn })
})

const dbUser = { id: PERSON, orgId: ORG, name: "Asha M", email: "asha@example.test", role: "manager", isActive: true }

function fixtures(): BoqStore {
  const s = makeBoqStore()
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Lakeview" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere" },
  ])
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.test" }])
  return s
}

let silenced: Array<{ mockRestore: () => void }> = []
beforeEach(() => {
  store = fixtures()
  identity = { dbUser, apiKey: null }
  stubActing = null
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})]
})
afterEach(() => {
  for (const s of silenced) s.mockRestore()
})
afterAll(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard)
})

const FENCE = "```"
/** One fenced block, the way an AI prints it. */
const fence = (json: unknown, language = "projexa-proposal") => `${FENCE}${language}\n${typeof json === "string" ? json : JSON.stringify(json)}\n${FENCE}`
const LINE = { itemCode: "P1", description: "Brick masonry in cement mortar", unit: "cum", quantity: 12, rate: 5200 }
const block = (over: Record<string, unknown> = {}) => ({
  v: 1,
  function: "create_boq",
  params: { title: "Pasted BOQ", lineItems: [LINE] },
  note: "prepared in a chat",
  ...over,
})
const withParams = (params: Record<string, unknown>) => block({ params })

const send = (body: unknown, projectId = PROJECT_A) =>
  paste(
    new Request(`https://x/api/v1/projexa/projects/${projectId}/paste-back`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: projectId }) }
  )
const pasteText = (text: string, projectId = PROJECT_A) => send({ text }, projectId)
const list = (projectId = PROJECT_A) => approvalsGET(new Request(`https://x/api/v1/projexa/projects/${projectId}/approvals`), { params: Promise.resolve({ id: projectId }) })
const approve = (submissionId: string) =>
  approvalsPOST(
    new Request(`https://x/api/v1/projexa/projects/${PROJECT_A}/approvals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ submissionId }) }),
    { params: Promise.resolve({ id: PROJECT_A }) }
  )
const table = (name: string): Row[] => rowsOf(store, name)
const snapshot = () => JSON.stringify(store.tables)
const BOQ_TABLES = ["construction_boqs", "construction_boq_line_items", "pipeline_tasks", "audit_logs", "tasks"]
const noBoqWritten = () => BOQ_TABLES.map((t) => table(t).length)

describe("BR-424: a valid pasted block stores 1 proposal that the approvals route lists, and writes 0 BOQ rows", () => {
  test("*** THE ROW: 1 pending proposal under the person, listed by GET .../approvals, 0 BOQ line items ***", async () => {
    const res = await pasteText(`Here is the change I prepared for you:\n\n${fence(block())}\n\nPaste it into the approval page.`)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.stored).toBe(1)

    // Read from the store, not from the response.
    expect(table("submissions")).toHaveLength(1)
    const [row] = table("submissions")
    expect(row.id).toBe(body.proposals[0].submissionId)
    expect([row.orgId, row.projectId, row.userId, row.mode, row.status, row.classification, row.rawInput]).toEqual([ORG, PROJECT_A, PERSON, "Projects", "in_progress", "TASK", "new boq"])
    expect(row.selectedChain).toEqual({
      source: "paste_back",
      functionId: "create_boq",
      // validate() filled the project from the URL: the block did not name one.
      params: { projectId: PROJECT_A, title: "Pasted BOQ", lineItems: [LINE] },
      note: "prepared in a chat",
    })
    // No model was asked and nothing was measured: the Level 1 columns stay empty.
    expect([row.level1Outcome, row.modelCalls, row.level]).toEqual([null, null, null])
    // 0 BOQ rows of any kind, no task, no audit row.
    expect(noBoqWritten()).toEqual([0, 0, 0, 0, 0])
    expect(store.maxOpen).toBeLessThanOrEqual(1)
    expect(store.unparsed).toEqual([])

    // The approvals route lists exactly that proposal, with its approve action.
    const listed = await (await list()).json()
    expect(listed.count).toBe(1)
    const [proposal] = listed.proposals
    expect(proposal.submissionId).toBe(row.id)
    expect([proposal.source, proposal.functionId, proposal.label, proposal.note, proposal.preparedById]).toEqual(["paste_back", "create_boq", "New BOQ", "prepared in a chat", PERSON])
    expect(proposal.params).toEqual({ projectId: PROJECT_A, title: "Pasted BOQ", lineItems: [LINE] })
    expect(proposal.missing).toEqual([])
    expect(proposal.approve).toEqual({ action: "approve", method: "POST", path: `/api/v1/projexa/projects/${PROJECT_A}/approvals`, body: { submissionId: row.id } })
    // Listing changed nothing.
    expect(noBoqWritten()).toEqual([0, 0, 0, 0, 0])
  })

  test("the pasted proposal is the object the approval works on: approving it writes the line item", async () => {
    const stored = await (await pasteText(fence(block()))).json()

    const res = await approve(stored.proposals[0].submissionId)

    expect(res.status).toBe(201)
    const [item] = table("construction_boq_line_items")
    expect([item.itemCode, item.description, item.unit, Number(item.quantity), Number(item.rate)]).toEqual(["P1", "Brick masonry in cement mortar", "cum", 12, 5200])
    expect(table("construction_boqs").map((b) => [b.title, b.projectId, b.createdById])).toEqual([["Pasted BOQ", PROJECT_A, PERSON]])
    expect(table("audit_logs").filter((a) => a.surface === "s1_one_page_ai_prepared")).toHaveLength(1)
  })

  test("a json fence and a bare fence are read like the projexa-proposal fence; other fenced code is not ours", async () => {
    const text = [fence(block({ params: { title: "By json fence", lineItems: [] } }), "json"), fence(block({ params: { title: "By bare fence", lineItems: [] } }), ""), fence("print('not a proposal')", "python")].join("\n\n")

    const body = await (await pasteText(text)).json()

    expect(body.stored).toBe(2)
    expect(table("submissions").map((r) => (r.selectedChain as { params: { title: string } }).params.title).sort()).toEqual(["By bare fence", "By json fence"])
  })

  test("two blocks store two proposals, in one transaction", async () => {
    const text = `${fence(block({ params: { title: "First", lineItems: [] } }))}\n\n${fence(block({ params: { title: "Second", lineItems: [LINE] } }))}`

    const res = await pasteText(text)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.stored).toBe(2)
    expect(table("submissions")).toHaveLength(2)
    expect(body.proposals.map((p: { submissionId: string }) => p.submissionId).sort()).toEqual(table("submissions").map((r) => r.id as string).sort())
    expect((await (await list()).json()).count).toBe(2)
    expect(noBoqWritten()).toEqual([0, 0, 0, 0, 0])
  })

  test("a block that names the URL's own project is accepted, and a note is kept to 500 characters", async () => {
    const res = await pasteText(fence(block({ params: { projectId: PROJECT_A, title: "Named", lineItems: [] }, note: "n".repeat(600) })))

    expect(res.status).toBe(201)
    const [row] = table("submissions")
    expect((row.selectedChain as { note: string; params: { projectId: string } }).note).toHaveLength(500)
    expect((row.selectedChain as { params: { projectId: string } }).params.projectId).toBe(PROJECT_A)
  })

  test("the proposal is stored under the person, not the key that carried the call", async () => {
    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "PROJEXA proxy", scopes: ["write"], keyKind: "org_service", projectId: null } }
    stubActing = { person: dbUser, actor: { dbUser, apiKey: { id: KEY_ID, name: "PROJEXA proxy" }, actingViaApiKey: true } }

    const res = await pasteText(fence(block()))

    expect(res.status).toBe(201)
    expect(table("submissions")[0].userId).toBe(PERSON)
  })
})

describe("BR-424: a block that fails the function registry's schema is 422 and stores 0 proposals", () => {
  const CASES: Array<{ name: string; text: string; code: string; reason?: string; detail?: string }> = [
    { name: "a function the registry does not have", text: fence(block({ function: "delete_everything" })), code: "FUNCTION_NOT_AVAILABLE" },
    { name: "a registry function this list does not approve", text: fence(block({ function: "record_work_progress", params: { itemCode: "1.01", percent: 40 } })), code: "FUNCTION_NOT_AVAILABLE" },
    { name: "a create_boq without its required title", text: fence(withParams({ lineItems: [LINE] })), code: "TITLE_REQUIRED" },
    { name: "a params.projectId naming another project of the organisation", text: fence(withParams({ projectId: PROJECT_B, title: "T", lineItems: [] })), code: "PROJECT_NOT_REACHABLE" },
    { name: "a params.projectId naming another organisation's project", text: fence(withParams({ projectId: PROJECT_OTHER_ORG, title: "T", lineItems: [] })), code: "PROJECT_NOT_REACHABLE" },
    { name: "a params.projectId that is not a string", text: fence(withParams({ projectId: 5, title: "T", lineItems: [] })), code: "PROJECT_REQUIRED" },
    { name: "a line item with no unit", text: fence(withParams({ title: "T", lineItems: [{ description: "No unit", quantity: 1, rate: 1 }] })), code: "REQUEST_REJECTED", detail: "unit" },
    { name: "lineItems that is not a list", text: fence(withParams({ title: "T", lineItems: "ten bricks" })), code: "REQUEST_REJECTED" },
    { name: "line items under a key the service does not read", text: fence(withParams({ title: "T", items: [LINE] })), code: "REQUEST_REJECTED", detail: "items" },
    { name: "a negative quantity", text: fence(withParams({ title: "T", lineItems: [{ ...LINE, quantity: -1 }] })), code: "REQUEST_REJECTED", detail: "quantity" },
    { name: "a block that is not JSON", text: fence("{not json"), code: "REQUEST_REJECTED", reason: "block_not_json" },
    { name: "a block that is a JSON list", text: fence("[1,2,3]"), code: "REQUEST_REJECTED", reason: "block_not_object" },
    { name: "an unsupported block version", text: fence(block({ v: 2 })), code: "REQUEST_REJECTED", reason: "unsupported_version" },
    { name: "a block with no function", text: fence({ v: 1, params: {} }), code: "REQUEST_REJECTED", reason: "function_missing" },
    { name: "params that is not an object", text: fence(block({ params: ["title"] })), code: "REQUEST_REJECTED", reason: "params_not_object" },
    { name: "JSON with no fence", text: JSON.stringify(block()), code: "REQUEST_REJECTED", reason: "no_block" },
    { name: "only fenced code of another language", text: fence(block(), "python"), code: "REQUEST_REJECTED", reason: "no_block" },
    { name: "text with no block at all", text: "I could not prepare that change.", code: "REQUEST_REJECTED", reason: "no_block" },
    { name: "more than 20 blocks", text: Array.from({ length: 21 }, () => fence(withParams({ title: "T", lineItems: [] }))).join("\n"), code: "REQUEST_REJECTED", reason: "too_many_blocks" },
  ]

  for (const c of CASES) {
    test(`${c.name}: 422 ${c.code}, 0 proposals stored, nothing else written`, async () => {
      const before = snapshot()

      const res = await pasteText(c.text)
      const body = await res.json()

      expect(res.status).toBe(422)
      expect(body.stored).toBe(0)
      expect(body.failure.code).toBe(c.code)
      if (c.reason) expect(body.failure.context.reason).toBe(c.reason)
      if (c.detail) expect(body.detail).toContain(c.detail)
      // Read from the store: not one row of any table changed, so 0 proposals and 0 BOQ rows.
      expect(snapshot()).toBe(before)
      expect(table("submissions")).toHaveLength(0)
      expect((await (await list()).json()).count).toBe(0)
    })
  }

  test("a paste is all or nothing: a valid block beside an invalid one stores nothing, and the answer names the block", async () => {
    const before = snapshot()

    const res = await pasteText(`${fence(block())}\n\n${fence(withParams({ lineItems: [LINE] }))}`)
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.block).toBe(1)
    expect(body.failure.code).toBe("TITLE_REQUIRED")
    expect(snapshot()).toBe(before)
  })
})

describe("BR-424: who may paste, and where", () => {
  test("an API-key call that names no person is refused (400 ACTING_USER_REQUIRED) and stores nothing", async () => {
    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "PROJEXA proxy", scopes: ["write"], keyKind: "org_service", projectId: null } }
    const before = snapshot()

    const res = await pasteText(fence(block()))

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("ACTING_USER_REQUIRED")
    expect(snapshot()).toBe(before)
  })

  test("a session below member and a key without the write scope are refused (403)", async () => {
    const before = snapshot()

    identity = { dbUser: { ...dbUser, role: "viewer" }, apiKey: null }
    expect((await pasteText(fence(block()))).status).toBe(403)

    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "Read only", scopes: ["read"], keyKind: "org_service", projectId: null } }
    expect((await pasteText(fence(block()))).status).toBe(403)

    expect(snapshot()).toBe(before)
  })

  test("a project that does not exist, and another organisation's project, are 404 and store nothing, though the block is valid", async () => {
    const before = snapshot()

    for (const projectId of ["no_such_project", PROJECT_OTHER_ORG]) {
      const res = await pasteText(fence(block()), projectId)
      expect([projectId, res.status]).toEqual([projectId, 404])
    }
    expect(snapshot()).toBe(before)
  })

  test("a project-pinned key pastes into its own project only: another project is 404 and stores nothing", async () => {
    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "Project key", scopes: ["write"], keyKind: "project_ai", projectId: PROJECT_B } }
    stubActing = { person: dbUser, actor: { dbUser, apiKey: { id: KEY_ID, name: "Project key" }, actingViaApiKey: true } }
    const before = snapshot()

    expect((await pasteText(fence(block()), PROJECT_A)).status).toBe(404)
    expect(snapshot()).toBe(before)

    const own = await pasteText(fence(block()), PROJECT_B)
    expect(own.status).toBe(201)
    expect(table("submissions").map((r) => r.projectId)).toEqual([PROJECT_B])
  })

  test("a body that is not a JSON object, has no text, or has text that is not a string is 400; oversized text is 413", async () => {
    const before = snapshot()

    expect((await send("not json")).status).toBe(400)
    expect((await send([fence(block())])).status).toBe(400)
    expect((await send({})).status).toBe(400)
    expect((await send({ text: 5 })).status).toBe(400)
    expect((await send({ text: "x".repeat(200_001) })).status).toBe(413)

    expect(snapshot()).toBe(before)
  })
})
