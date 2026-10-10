/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-29, register row BR-410 (surface 1 of the four-surface contract). Approving an AI-prepared BOQ
// line-item proposal writes the line item, the re-read row equals the proposal, and exactly 1 compliance.audit_logs
// row for that line item has surface s1_one_page_ai_prepared and a non-null user_id.
//
// The approve action is POST /api/v1/projexa/projects/[id]/approvals (posted by the "approve" action that GET lists,
// BR-409). This file sits beside the tasks route because the register row names this path; the route it drives is the
// approvals route.
//
// The proposal is made by the REAL U-31 email bridge in the state the live database is in (PMD-38): no phrase_map row
// for create_boq and the Level 1 gate refusing the model, so the stored words "new boq" resolve to nothing and the row
// is stored as chat. Approving it must still write the line item, because the approval reads the parameters stored in
// selected_chain and never re-derives them from the words. A second test replaces the stored words with unrelated
// ones and gets the same BOQ.
//
// Also proven, because they are what "approve persists, attributed to the person" means:
//   - the BOQ is recorded under the person (created_by_id) and the audit row names the person, also when an API key
//     carried the call (both ids on one row, actor role not api_key);
//   - an API-key call that names no person is refused (400) and writes nothing;
//   - a proposal of another project, of another organisation, a typed message and a proposal naming another function
//     read as absent (404) and write nothing; the project of the URL is checked on every call;
//   - a second Approve is refused (409) and writes nothing more;
//   - a proposal missing a parameter answers with the question (200), the person's answer completes it, and a
//     proposal that cannot be written (another project, a bad line item) is refused (422) and stays pending;
//   - one audit row per line item, and one for the BOQ when the proposal has no lines;
//   - when the audit write fails the answer is a 500 that says the record was saved;
//   - no transaction is ever nested and every where clause is evaluated for real;
//   - (fix round 1) two Approves posted together write one BOQ: the first claims the proposal, the others are 409;
//   - (fix round 1) a claim is given back when the run threw before it minted its task (nothing can have been written),
//     and kept when it threw after (a retry could write a second BOQ);
//   - (fix round 1) an error in the bookkeeping after the write, including the submission's own status, neither undoes
//     the write nor lets it be repeated;
//   - (fix round 1) when the audit rows are not written the debt is recorded on the proposal, only the approving person's
//     next Approve writes them, and two overlapping repairs write them once.
//
// WHAT IS REAL: the route, prepared-proposals.ts, email-intelligence-service.ts, run-submission.ts (runDirectTask,
// submitForVerdict), validate(), executor.ts, function-registry.ts, createBoq(), logActivity, requireRoleOrScope and
// requireActingPerson (session path). WHAT IS FAKED: @/lib/db/tenant-scoped, by
// src/lib/pipeline/__test-helpers__/boq-store-double.ts (real where clauses over fixture rows, writes committed only
// when the transaction resolves), requireAuthOrApiKey (the identity), the task engine's executeTask, and, in two
// tests only, requireActingPerson (a key plus a person) and logActivity (a failing audit write).
//
// Run: bun test --isolate src/app/api/v1/projexa/tasks/route.surface1-approve.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { failNext, fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "@/lib/pipeline/__test-helpers__/boq-store-double"

const ORG = "org_1"
const OTHER_ORG = "org_2"
const PROJECT_A = "project_a"
const PROJECT_B = "project_b"
const PROJECT_OTHER_ORG = "project_x"
const PERSON = "person_1"
const KEY_ID = "key_1"
const ITEM = "eii_1"
const SURFACE = "s1_one_page_ai_prepared"

let store: BoqStore
let identity: { dbUser: Record<string, unknown> | null; apiKey: Record<string, unknown> | null }
let stubActing: { person: Record<string, unknown>; actor: Record<string, unknown> } | null = null
let failAudit = false

const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }))

const realAuthGuard = await import("@/lib/supabase/auth-guard")
// Captured before the mock is installed: mock.module replaces the module in place, so calling it through the
// namespace object afterwards would call the stand-in again.
const realRequireActingPerson = realAuthGuard.requireActingPerson
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => ({ orgId: ORG, response: null, ...identity })),
  // The real function answers for a session and for a key that names nobody; one test stubs a key plus a person, which
  // the real function would look up through the shared database client.
  requireActingPerson: async (request: Request, ctx: never, body?: unknown) =>
    stubActing ? { acting: stubActing, error: null } : realRequireActingPerson(request, ctx, body),
}))

const realAudit = await import("@/lib/audit")
const realLogActivity = realAudit.logActivity
mock.module("@/lib/audit", () => ({
  ...realAudit,
  logActivity: async (params: Parameters<typeof realLogActivity>[0]) => {
    if (failAudit) throw new Error("audit store unavailable")
    return realLogActivity(params)
  },
}))

const realEngine = await import("@/lib/task-execution-engine")
mock.module("@/lib/task-execution-engine", () => ({ ...realEngine, executeTask: async () => ({ success: true }) }))

type RouteFn = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let GET: RouteFn
let POST: RouteFn
let service: typeof import("@/lib/services/email-intelligence-service")
beforeAll(async () => {
  ;({ GET, POST } = (await import("@/app/api/v1/projexa/projects/[id]/approvals/route")) as unknown as { GET: RouteFn; POST: RouteFn })
  service = await import("@/lib/services/email-intelligence-service")
})

const dbUser = { id: PERSON, orgId: ORG, name: "Asha M", email: "asha@example.test", role: "manager", isActive: true }

/** The BOQ line suggestion as analyzeInboundEmail stores it. */
const BOQ_SUGGESTION = {
  title: "Add BOQ line: Excavation in ordinary soil",
  category: "boq_line_item",
  assignee: null,
  dueDateHint: null,
  boqLineItem: { projectId: PROJECT_A, boqTitle: "Villa 21 - Tender BOQ", itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450 },
}

function fixtures(): BoqStore {
  const s = makeBoqStore()
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Lakeview" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere" },
  ])
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.test" }])
  // No phrase_map row: nothing resolves "new boq", as on the live database.
  seedRows(s, "email_intelligence_items", [
    { id: ITEM, orgId: ORG, submittedById: PERSON, subject: "BOQ for Villa 21", senderEmail: "site@vendor.test", body: "Please add excavation.", status: "proposed", aiSuggestedWorkItems: [BOQ_SUGGESTION] },
  ])
  return s
}

const line = (over: Record<string, unknown> = {}) => ({ description: "Seeded line", unit: "nos", quantity: 2, rate: 10, ...over })
const preparedChain = (over: Record<string, unknown> = {}) => ({
  source: "paste_back",
  functionId: "create_boq",
  params: { projectId: PROJECT_A, title: "Seeded BOQ", lineItems: [line()] },
  ...over,
})
const submissionRow = (over: Record<string, unknown>) => ({
  orgId: ORG,
  projectId: PROJECT_A,
  mode: "Projects",
  rawInput: "new boq",
  userId: PERSON,
  status: "in_progress",
  selectedChain: preparedChain(),
  ...over,
})

const ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_PROVIDER_PIPELINE_L2", "AI_ALLOWED_PROVIDERS", "RAJAT_USER_ID"] as const
const SAVED = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>

let silenced: Array<{ mockRestore: () => void }> = []
beforeEach(() => {
  store = fixtures()
  identity = { dbUser, apiKey: null }
  stubActing = null
  failAudit = false
  for (const k of ENV_KEYS) delete process.env[k]
  // Any model call would be refused by the gate, so a code path that re-derives from the words fails instead of reaching a provider.
  process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli"
  process.env.RAJAT_USER_ID = "someone_else"
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})]
})
afterEach(() => {
  for (const s of silenced) s.mockRestore()
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED[k]
  }
})
afterAll(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard)
  await mock.module("@/lib/audit", () => realAudit)
  await mock.module("@/lib/task-execution-engine", () => realEngine)
})

const ctx = () => ({ orgId: ORG, userId: PERSON, dbUser: dbUser as never })
const promote = () => service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 0 }) as Promise<{ proposal: { submissionId: string; staged: boolean } }>
const approve = (body: unknown, projectId = PROJECT_A, headers: Record<string, string> = {}) =>
  POST(
    new Request(`https://x/api/v1/projexa/projects/${projectId}/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: projectId }) }
  )
const list = (projectId = PROJECT_A) => GET(new Request(`https://x/api/v1/projexa/projects/${projectId}/approvals`), { params: Promise.resolve({ id: projectId }) })
const snapshot = () => JSON.stringify(store.tables)
const table = (name: string): Row[] => rowsOf(store, name)
const surfaceRows = () => table("audit_logs").filter((a) => a.surface !== null && a.surface !== undefined)

describe("BR-410: approving a prepared BOQ line-item proposal persists it, attributed to the person", () => {
  test("*** THE ROW: the line item is written, the re-read row equals the proposal, and 1 audit row has surface s1 and a user ***", async () => {
    const { proposal } = await promote()
    // The live state: the stored words resolved to nothing.
    expect(proposal.staged).toBe(false)
    expect(table("submissions")[0].status).toBe("chat")
    expect(table("phrase_map")).toHaveLength(0)
    expect(table("construction_boq_line_items")).toHaveLength(0)

    const res = await approve({ submissionId: proposal.submissionId })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.approved).toBe(true)

    // Everything below is read from the store, not from the response.
    const lines = table("construction_boq_line_items")
    expect(lines).toHaveLength(1)
    const [item] = lines
    expect([item.orgId, item.itemCode, item.description, item.unit, Number(item.quantity), Number(item.rate)]).toEqual([
      ORG,
      "1.01",
      "Excavation in ordinary soil",
      "cum",
      120,
      450,
    ])
    const [boq] = table("construction_boqs")
    expect([boq.orgId, boq.projectId, boq.title, boq.createdById]).toEqual([ORG, PROJECT_A, "Villa 21 - Tender BOQ", PERSON])
    expect(item.boqId).toBe(boq.id)
    expect(body.boqId).toBe(boq.id)
    expect(body.lineItemIds).toEqual([item.id])

    // Exactly 1 audit row for that line item, with the surface and a real user.
    const audits = table("audit_logs").filter((a) => a.entityId === item.id)
    expect(audits).toHaveLength(1)
    const [audit] = audits
    expect([audit.surface, audit.userId, audit.orgId, audit.actorRole, audit.apiKeyId, audit.action, audit.entityType]).toEqual([
      SURFACE,
      PERSON,
      ORG,
      "manager",
      null,
      "boq_line_item.approved_from_proposal",
      "construction_boq_line_item",
    ])
    expect(audit.userId).not.toBeNull()
    expect(JSON.parse(audit.details as string)).toEqual({
      surface: SURFACE,
      source: "email_intelligence",
      functionId: "create_boq",
      submissionId: proposal.submissionId,
      boqId: boq.id,
    })
    // The only audit row that names a surface is that one (the promote's own row names none).
    expect(surfaceRows()).toHaveLength(1)
    expect(body.audit).toEqual({ surface: SURFACE, rows: 1, entityType: "construction_boq_line_item" })

    // The proposal is decided: its own row is done, and the list no longer offers it.
    expect(table("submissions")).toHaveLength(1)
    expect(table("submissions")[0].status).toBe("done")
    expect((await (await list()).json()).count).toBe(0)
    expect(store.maxOpen).toBeLessThanOrEqual(1)
    expect(store.unparsed).toEqual([])
  })

  test("the stored words are not read: replaced by unrelated ones, the approval writes the same BOQ", async () => {
    const { proposal } = await promote()
    table("submissions")[0].rawInput = "record 40 percent complete on 1.01"

    const res = await approve({ submissionId: proposal.submissionId })

    expect(res.status).toBe(201)
    const [boq] = table("construction_boqs")
    expect(boq.title).toBe("Villa 21 - Tender BOQ")
    expect(table("construction_boq_line_items").map((l) => l.itemCode)).toEqual(["1.01"])
    // No task other than create_boq was minted from the words.
    expect(table("pipeline_tasks").map((t) => [t.functionId, t.status])).toEqual([["create_boq", "done"]])
  })

  test("an in_progress proposal (its words resolved) is approved the same way", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_ok" })])

    const res = await approve({ submissionId: "sub_ok" })

    expect(res.status).toBe(201)
    expect(table("construction_boqs").map((b) => b.title)).toEqual(["Seeded BOQ"])
    expect(table("submissions")[0].status).toBe("done")
  })
})

describe("BR-410: the person is the actor", () => {
  test("a session's person is the BOQ's creator; an API key that carried the call is kept beside the person on the audit row", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_key" })])
    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "PROJEXA proxy", scopes: ["write"], keyKind: "org_service", projectId: null } }
    stubActing = { person: dbUser, actor: { dbUser, apiKey: { id: KEY_ID, name: "PROJEXA proxy" }, actingViaApiKey: true } }

    const res = await approve({ submissionId: "sub_key" })

    expect(res.status).toBe(201)
    // The BOQ is recorded under the person, never under the key (PMD-35).
    expect(table("construction_boqs")[0].createdById).toBe(PERSON)
    const [audit] = surfaceRows()
    expect([audit.surface, audit.userId, audit.apiKeyId, audit.actorRole]).toEqual([SURFACE, PERSON, KEY_ID, "manager"])
    expect(audit.actorRole).not.toBe("api_key")
    // The pipeline task was minted for the person too.
    expect(table("pipeline_tasks")[0].orgId).toBe(ORG)
  })

  test("an API-key call that names no person is refused (400 ACTING_USER_REQUIRED) and writes nothing", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_anon" })])
    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "PROJEXA proxy", scopes: ["write"], keyKind: "org_service", projectId: null } }
    const before = snapshot()

    const res = await approve({ submissionId: "sub_anon" })

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("ACTING_USER_REQUIRED")
    expect(snapshot()).toBe(before)
  })

  test("a session below member is refused (403), a key without the write scope is refused (403), and nothing is written", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_role" })])
    const before = snapshot()

    identity = { dbUser: { ...dbUser, role: "viewer" }, apiKey: null }
    expect((await approve({ submissionId: "sub_role" })).status).toBe(403)

    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "Read only", scopes: ["read"], keyKind: "org_service", projectId: null } }
    expect((await approve({ submissionId: "sub_role" })).status).toBe(403)

    expect(snapshot()).toBe(before)
  })
})

describe("BR-410: the project of the URL is checked, and only a prepared proposal of that project is approved", () => {
  test("a proposal of another project, of another organisation, a typed message and another function are 404 and write nothing", async () => {
    seedRows(store, "submissions", [
      submissionRow({ id: "sub_other_project", projectId: PROJECT_B, selectedChain: preparedChain({ params: { projectId: PROJECT_B, title: "B", lineItems: [] } }) }),
      submissionRow({ id: "sub_other_org", orgId: OTHER_ORG }),
      submissionRow({ id: "sub_typed", rawInput: "record 40 percent on 1.01", selectedChain: { mode: "Projects", verb: "record" } }),
      submissionRow({ id: "sub_no_chain", selectedChain: null }),
      submissionRow({ id: "sub_other_fn", selectedChain: preparedChain({ functionId: "record_work_progress" }) }),
    ])
    const before = snapshot()

    for (const id of ["sub_other_project", "sub_other_org", "sub_typed", "sub_no_chain", "sub_other_fn", "no_such_submission"]) {
      const res = await approve({ submissionId: id })
      expect([id, res.status]).toEqual([id, 404])
    }
    expect(snapshot()).toBe(before)
  })

  test("a project that does not exist, and another organisation's project, are 404 and write nothing", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_a" }), submissionRow({ id: "sub_x", orgId: OTHER_ORG, projectId: PROJECT_OTHER_ORG })])
    const before = snapshot()

    for (const [projectId, id] of [
      ["no_such_project", "sub_a"],
      [PROJECT_OTHER_ORG, "sub_x"],
      [PROJECT_OTHER_ORG, "sub_a"],
    ]) {
      const res = await approve({ submissionId: id }, projectId)
      expect([projectId, id, res.status]).toEqual([projectId, id, 404])
    }
    expect(snapshot()).toBe(before)
  })

  test("a project-pinned key acts on its own project only: another project is 404 before anything is read", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_a" })])
    identity = { dbUser: null, apiKey: { id: KEY_ID, name: "Project key", scopes: ["write"], keyKind: "project_ai", projectId: PROJECT_B } }
    stubActing = { person: dbUser, actor: { dbUser, apiKey: { id: KEY_ID, name: "Project key" }, actingViaApiKey: true } }
    const before = snapshot()

    const res = await approve({ submissionId: "sub_a" }, PROJECT_A)

    expect(res.status).toBe(404)
    expect(snapshot()).toBe(before)
  })

  test("a second Approve is refused (409) and writes nothing more", async () => {
    const { proposal } = await promote()
    expect((await approve({ submissionId: proposal.submissionId })).status).toBe(201)
    const after = snapshot()

    const again = await approve({ submissionId: proposal.submissionId })

    expect(again.status).toBe(409)
    expect((await again.json()).status).toBe("done")
    expect(snapshot()).toBe(after)
    expect(table("construction_boqs")).toHaveLength(1)
    expect(table("construction_boq_line_items")).toHaveLength(1)
    expect(surfaceRows()).toHaveLength(1)
  })
})

describe("BR-410: a proposal that is not complete or cannot be written is not approved, and stays pending", () => {
  test("a missing title answers with the question (200), and the person's answer completes the approval", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_no_title", selectedChain: preparedChain({ params: { projectId: PROJECT_A, lineItems: [line({ description: "Kerb" })] } }) })])
    const before = snapshot()

    const asked = await approve({ submissionId: "sub_no_title" })

    expect(asked.status).toBe(200)
    expect(await asked.json()).toEqual({ approved: false, status: "needs_input", missing: [{ name: "title", label: "Title", code: "TITLE_REQUIRED" }] })
    expect(snapshot()).toBe(before)

    const answered = await approve({ submissionId: "sub_no_title", params: { title: "Added by the approver" } })

    expect(answered.status).toBe(201)
    expect(table("construction_boqs").map((b) => b.title)).toEqual(["Added by the approver"])
    // The stored lines are what was written, merged with the answer.
    expect(table("construction_boq_line_items").map((l) => l.description)).toEqual(["Kerb"])
  })

  test("params naming another project are refused (422 PROJECT_NOT_REACHABLE): nothing is written and the proposal stays pending", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_a" })])
    const before = snapshot()

    const res = await approve({ submissionId: "sub_a", params: { projectId: PROJECT_B } })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.approved).toBe(false)
    expect(body.failure.code).toBe("PROJECT_NOT_REACHABLE")
    expect(snapshot()).toBe(before)
    expect((await (await list()).json()).count).toBe(1)
  })

  test("a line item the BOQ service would refuse is 422 before anything is written, and the proposal stays pending", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_bad_line", selectedChain: preparedChain({ params: { projectId: PROJECT_A, title: "Bad", lineItems: [{ description: "No unit", quantity: 1, rate: 1 }] } }) })])
    const before = snapshot()

    const res = await approve({ submissionId: "sub_bad_line" })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.failure.code).toBe("REQUEST_REJECTED")
    expect(body.detail).toContain("unit")
    expect(snapshot()).toBe(before)
  })

  test("line items stored under a key the service does not read are 422 (the header-only BOQ that would follow is not written)", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_items_key", selectedChain: preparedChain({ params: { projectId: PROJECT_A, title: "Misnamed", items: [line()] } }) })])
    const before = snapshot()

    const res = await approve({ submissionId: "sub_items_key" })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.failure.code).toBe("REQUEST_REJECTED")
    expect(body.detail).toContain("items")
    expect(snapshot()).toBe(before)
  })

  test("a body that is not a JSON object, or has no submissionId, is 400", async () => {
    const before = snapshot()
    expect((await approve("not json")).status).toBe(400)
    expect((await approve([1, 2])).status).toBe(400)
    expect((await approve({})).status).toBe(400)
    expect((await approve({ submissionId: "x", params: "title" })).status).toBe(400)
    expect(snapshot()).toBe(before)
  })
})

describe("BR-410: one audit row per line item created", () => {
  test("a proposal with 2 lines writes 2 line items and 2 audit rows, one per line item", async () => {
    seedRows(store, "submissions", [
      submissionRow({ id: "sub_two", selectedChain: preparedChain({ params: { projectId: PROJECT_A, title: "Two lines", lineItems: [line({ itemCode: "A1", description: "First" }), line({ itemCode: "A2", description: "Second" })] } }) }),
    ])

    const res = await approve({ submissionId: "sub_two" })
    const body = await res.json()

    expect(res.status).toBe(201)
    const items = table("construction_boq_line_items")
    expect(items).toHaveLength(2)
    expect(body.lineItemIds.sort()).toEqual(items.map((i) => i.id as string).sort())
    expect(surfaceRows().map((a) => a.entityId).sort()).toEqual(items.map((i) => i.id as string).sort())
    for (const a of surfaceRows()) expect([a.surface, a.userId, a.entityType]).toEqual([SURFACE, PERSON, "construction_boq_line_item"])
  })

  test("a proposal with no lines writes a header-only BOQ and one audit row on the BOQ", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_empty", selectedChain: preparedChain({ params: { projectId: PROJECT_A, title: "Header only", lineItems: [] } }) })])

    const res = await approve({ submissionId: "sub_empty" })

    expect(res.status).toBe(201)
    expect(table("construction_boq_line_items")).toHaveLength(0)
    const [boq] = table("construction_boqs")
    const audits = surfaceRows()
    expect(audits).toHaveLength(1)
    expect([audits[0].entityType, audits[0].entityId, audits[0].surface, audits[0].userId]).toEqual(["construction_boq", boq.id, SURFACE, PERSON])
  })

  test("when the audit write fails the answer is a 500 that says the record was saved", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_audit" })])
    failAudit = true

    const res = await approve({ submissionId: "sub_audit" })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe("AUDIT_WRITE_FAILED")
    expect(body.approved).toBe(true)
    expect(table("construction_boq_line_items")).toHaveLength(1)
    expect(body.lineItemIds).toEqual([table("construction_boq_line_items")[0].id])
    expect(surfaceRows()).toHaveLength(0)
  })
})

/** What every test below reads the decided/claimed state of a proposal from: the stored row, never a response. */
const chainOf = (id: string) => (table("submissions").find((r) => r.id === id) as { selectedChain: Record<string, unknown> | null }).selectedChain
const statusOf = (id: string) => table("submissions").find((r) => r.id === id)?.status
const errorCalls = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call.map(String).join(" "))

describe("BR-410 (fix round 1): overlapping Approves of one proposal write one BOQ", () => {
  test("*** two Approves posted together: one 201 and one 409, one BOQ, one line item, one audit row ***", async () => {
    store.serialise = true
    const { proposal } = await promote()

    const answers = await Promise.all([approve({ submissionId: proposal.submissionId }), approve({ submissionId: proposal.submissionId })])
    const statuses = answers.map((a) => a.status).sort()
    const refused = await answers.find((a) => a.status === 409)!.json()

    expect(statuses).toEqual([201, 409])
    // The loser's answer says what is true of the row when it asked: still being approved, or already decided.
    expect(
      (refused.status === "in_progress" && refused.error.includes("being approved")) || (refused.status === "done" && refused.error.includes("already been decided"))
    ).toBe(true)
    // The claim itself stopped the loser: an update of a submission that matched no row.
    expect(store.updateLog!.filter((u) => u.table === "submissions" && u.matched === 0).length).toBeGreaterThanOrEqual(1)
    // Read from the store: one of everything, and the proposal decided.
    expect(table("construction_boqs")).toHaveLength(1)
    expect(table("construction_boq_line_items")).toHaveLength(1)
    expect(surfaceRows()).toHaveLength(1)
    expect(table("pipeline_tasks")).toHaveLength(1)
    expect(statusOf(proposal.submissionId)).toBe("done")
    expect(store.unparsed).toEqual([])
  })

  test("five Approves posted together: exactly one 201, four 409, one BOQ", async () => {
    store.serialise = true
    seedRows(store, "submissions", [submissionRow({ id: "sub_five" })])

    const answers = await Promise.all(Array.from({ length: 5 }, () => approve({ submissionId: "sub_five" })))

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409, 409, 409, 409])
    expect(table("construction_boqs")).toHaveLength(1)
    expect(surfaceRows()).toHaveLength(1)
    expect(store.updateLog!.filter((u) => u.table === "submissions" && u.matched === 0).length).toBeGreaterThanOrEqual(1)
  })

  test("a claimed proposal that is also missing a parameter is 409 in_progress, not a question to answer", async () => {
    seedRows(store, "submissions", [
      submissionRow({
        id: "sub_held_open",
        selectedChain: preparedChain({ params: { projectId: PROJECT_A, lineItems: [] }, claimedAt: "2026-09-25T10:00:00.000Z", claimedBy: "person_2" }),
      }),
    ])
    const before = snapshot()

    const res = await approve({ submissionId: "sub_held_open" })

    expect(res.status).toBe(409)
    expect((await res.json()).status).toBe("in_progress")
    expect(snapshot()).toBe(before)
  })

  test("a proposal an Approve has claimed is 409 in_progress, is not offered again, and nothing is written", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_held", selectedChain: preparedChain({ claimedAt: "2026-09-25T10:00:00.000Z", claimedBy: "person_2" }) })])
    const before = snapshot()

    const res = await approve({ submissionId: "sub_held" })

    expect(res.status).toBe(409)
    expect((await res.json()).status).toBe("in_progress")
    expect((await (await list()).json()).count).toBe(0)
    expect(snapshot()).toBe(before)
  })
})

describe("BR-410 (fix round 1): a claim is given back only when nothing can have been written", () => {
  test("a run that throws before it minted its task gives the claim back: the proposal is pending again and a retry writes one BOQ", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_early" })])
    const original = JSON.parse(JSON.stringify(chainOf("sub_early")))
    failNext(store, "pipeline_tasks", "insert")

    const failed = await approve({ submissionId: "sub_early" })

    expect(failed.status).toBe(500)
    // Nothing was written, and the row is exactly what it was: no stamp left on it, and the list offers it again.
    expect(table("construction_boqs")).toHaveLength(0)
    expect(table("pipeline_tasks")).toHaveLength(0)
    expect(chainOf("sub_early")).toEqual(original)
    expect(statusOf("sub_early")).toBe("in_progress")
    expect((await (await list()).json()).count).toBe(1)

    const retried = await approve({ submissionId: "sub_early" })

    expect(retried.status).toBe(201)
    expect(table("construction_boqs")).toHaveLength(1)
    expect(surfaceRows()).toHaveLength(1)
  })

  test("a run that throws after its task was minted keeps the claim: a retry is 409 in_progress, never a second BOQ", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_late" })])
    // The first update of pipeline_tasks is markInProgress(): the task row exists, the executor has not run.
    failNext(store, "pipeline_tasks", "update")

    const failed = await approve({ submissionId: "sub_late" })

    expect(failed.status).toBe(500)
    expect(table("pipeline_tasks")).toHaveLength(1)
    // The stamp is on the row, with the person and a time, and the list does not offer the proposal.
    const stamp = chainOf("sub_late")!
    expect([typeof stamp.claimedAt, stamp.claimedBy]).toEqual(["string", PERSON])
    expect((await (await list()).json()).count).toBe(0)

    const retried = await approve({ submissionId: "sub_late" })

    expect(retried.status).toBe(409)
    expect((await retried.json()).status).toBe("in_progress")
    expect(table("construction_boqs")).toHaveLength(0)
    expect(table("pipeline_tasks")).toHaveLength(1)
  })
})

describe("BR-410 (fix round 1): an error in the bookkeeping after the write neither undoes it nor lets it be repeated", () => {
  test("pill-use bookkeeping fails after the BOQ is written: 201, one BOQ, one audit row, the proposal done; a second Approve is 409", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_pill" })])
    failNext(store, "pill_usage", "insert")

    const res = await approve({ submissionId: "sub_pill" })

    expect(res.status).toBe(201)
    expect(table("construction_boqs")).toHaveLength(1)
    expect(table("construction_boq_line_items")).toHaveLength(1)
    expect(surfaceRows()).toHaveLength(1)
    expect(statusOf("sub_pill")).toBe("done")
    expect(errorCalls().some((line) => line.includes("pill use failed after the write"))).toBe(true)

    const again = await approve({ submissionId: "sub_pill" })

    expect(again.status).toBe(409)
    expect(table("construction_boqs")).toHaveLength(1)
  })

  test("the submission's own status update fails after the write: 201 and one audit row, and a second Approve is 409, not a second BOQ", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_status" })])
    // The claim is the first update of a submission and the run's final status write is the second.
    failNext(store, "submissions", "update", { skip: 1 })

    const res = await approve({ submissionId: "sub_status" })

    expect(res.status).toBe(201)
    expect(table("construction_boqs")).toHaveLength(1)
    expect(surfaceRows()).toHaveLength(1)
    // The row never reached done, so it is still claimed rather than offered again.
    expect(statusOf("sub_status")).toBe("in_progress")
    expect(typeof chainOf("sub_status")!.claimedAt).toBe("string")
    expect((await (await list()).json()).count).toBe(0)
    expect(errorCalls().some((line) => line.includes("submission status failed after the write"))).toBe(true)

    const again = await approve({ submissionId: "sub_status" })

    expect(again.status).toBe(409)
    expect((await again.json()).status).toBe("in_progress")
    expect(table("construction_boqs")).toHaveLength(1)
    expect(surfaceRows()).toHaveLength(1)
  })
})

describe("BR-410 (fix round 1): audit rows that were not written can be written, by the person who approved, once", () => {
  const twoLines = () =>
    seedRows(store, "submissions", [
      submissionRow({
        id: "sub_owed",
        selectedChain: preparedChain({ params: { projectId: PROJECT_A, title: "Two lines", lineItems: [line({ itemCode: "A1", description: "First" }), line({ itemCode: "A2", description: "Second" })] } }),
      }),
    ])
  const lineItemIds = () => table("construction_boq_line_items").map((i) => i.id as string).sort()

  test("*** the audit write fails: the debt is recorded on the proposal, and the person's next Approve writes the rows ***", async () => {
    twoLines()
    failAudit = true

    const failed = await approve({ submissionId: "sub_owed" })
    const failure = await failed.json()

    expect(failed.status).toBe(500)
    expect(failure.code).toBe("AUDIT_WRITE_FAILED")
    expect(failure.auditRecorded).toBe(true)
    expect(failure.error).toContain("approve the same proposal again")
    expect(table("construction_boq_line_items")).toHaveLength(2)
    expect(surfaceRows()).toHaveLength(0)
    // The gap can be found: the row says who owes what, read from the store.
    expect(statusOf("sub_owed")).toBe("done")
    const owed = chainOf("sub_owed")!.auditPending as Record<string, unknown>
    expect([owed.personId, owed.source, owed.functionId, owed.boqId]).toEqual([PERSON, "paste_back", "create_boq", table("construction_boqs")[0].id])
    expect((owed.lineItemIds as string[]).slice().sort()).toEqual(lineItemIds())

    failAudit = false
    const repaired = await approve({ submissionId: "sub_owed" })
    const repair = await repaired.json()

    expect(repaired.status).toBe(200)
    expect(repair.auditRepaired).toBe(true)
    expect(repair.audit).toEqual({ surface: SURFACE, rows: 2, entityType: "construction_boq_line_item" })
    // Two rows, one per line item, each naming the person and the surface, and still one BOQ.
    expect(surfaceRows().map((a) => a.entityId as string).sort()).toEqual(lineItemIds())
    for (const a of surfaceRows()) expect([a.surface, a.userId, a.action]).toEqual([SURFACE, PERSON, "boq_line_item.approved_from_proposal"])
    expect(table("construction_boqs")).toHaveLength(1)
    expect(table("construction_boq_line_items")).toHaveLength(2)
    // The debt is cleared, so a further Approve is the ordinary 409.
    expect(chainOf("sub_owed")!.auditPending).toBeNull()
    const third = await approve({ submissionId: "sub_owed" })
    expect(third.status).toBe(409)
    expect(surfaceRows()).toHaveLength(2)
    expect(store.unparsed).toEqual([])
  })

  test("another person's Approve does not write the rows: 409, and the debt stays for the person who owes it", async () => {
    twoLines()
    failAudit = true
    expect((await approve({ submissionId: "sub_owed" })).status).toBe(500)
    failAudit = false
    identity = { dbUser: { ...dbUser, id: "person_2", email: "other@example.test" }, apiKey: null }

    const res = await approve({ submissionId: "sub_owed" })

    expect(res.status).toBe(409)
    expect(surfaceRows()).toHaveLength(0)
    expect((chainOf("sub_owed")!.auditPending as { personId: string }).personId).toBe(PERSON)
  })

  test("two repairs posted together write the rows once: one 200 and one 409", async () => {
    store.serialise = true
    twoLines()
    failAudit = true
    expect((await approve({ submissionId: "sub_owed" })).status).toBe(500)
    failAudit = false

    const answers = await Promise.all([approve({ submissionId: "sub_owed" }), approve({ submissionId: "sub_owed" })])

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409])
    expect(surfaceRows()).toHaveLength(2)
    expect(surfaceRows().map((a) => a.entityId as string).sort()).toEqual(lineItemIds())
  })

  test("a repair that fails again records the debt again, and a later Approve still writes the rows", async () => {
    twoLines()
    failAudit = true
    expect((await approve({ submissionId: "sub_owed" })).status).toBe(500)

    const again = await approve({ submissionId: "sub_owed" })

    expect(again.status).toBe(500)
    expect((await again.json()).auditRecorded).toBe(true)
    expect(surfaceRows()).toHaveLength(0)
    expect(chainOf("sub_owed")!.auditPending).not.toBeNull()

    failAudit = false
    const done = await approve({ submissionId: "sub_owed" })

    expect(done.status).toBe(200)
    expect(surfaceRows()).toHaveLength(2)
  })

  test("the run's own status write failed too: the row is still pending, and the person's next Approve writes the rows and completes it", async () => {
    twoLines()
    failAudit = true
    // Updates of a submission: the claim (1), the run's status write (2, fails and is not fatal), the debt marker (3).
    failNext(store, "submissions", "update", { skip: 1 })

    const failed = await approve({ submissionId: "sub_owed" })

    expect(failed.status).toBe(500)
    expect((await failed.json()).auditRecorded).toBe(true)
    expect(statusOf("sub_owed")).toBe("in_progress")
    expect(surfaceRows()).toHaveLength(0)

    failAudit = false
    const repaired = await approve({ submissionId: "sub_owed" })

    expect(repaired.status).toBe(200)
    expect(surfaceRows()).toHaveLength(2)
    expect(statusOf("sub_owed")).toBe("done")
    expect(table("construction_boqs")).toHaveLength(1)
    expect((await approve({ submissionId: "sub_owed" })).status).toBe(409)
  })

  test("when the debt cannot be recorded either, the answer says so and the ids go to the log", async () => {
    twoLines()
    failAudit = true
    // Updates of a submission: the claim (1), the run's status write (2), then the debt marker (3).
    failNext(store, "submissions", "update", { skip: 2 })

    const res = await approve({ submissionId: "sub_owed" })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe("AUDIT_WRITE_FAILED")
    expect(body.auditRecorded).toBe(false)
    expect(body.error).toContain("could not be recorded")
    expect(body.boqId).toBe(table("construction_boqs")[0].id)
    expect(chainOf("sub_owed")!.auditPending).toBeUndefined()
    const logged = errorCalls().find((l) => l.includes("audit owed"))
    expect(logged).toBeDefined()
    expect(logged).toContain(table("construction_boqs")[0].id as string)
  })
})
