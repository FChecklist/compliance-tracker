/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-29, register row BR-409 (surface 1 of the four-surface contract). GET
// /api/v1/projexa/projects/[id]/approvals answers 200 with the BOQ line-item proposals an AI prepared for the project
// and one approve action per proposal. It writes nothing and asks no model.
//
// The proposals here are made by the REAL U-31 email bridge (promoteEmailIntelligenceItem -> submitForVerdict ->
// proposeSubmission), so the test reads the store that code writes rather than a row invented for the test. Two
// organisations are covered on purpose:
//   - one whose phrase_map resolves the stored words "new boq" to create_boq (the submission is stored in_progress);
//   - one where nothing resolves them and the Level 1 gate refuses the model, which is the live state of the
//     database (PMD-38): the verdict is a gap, the row is stored as chat, and the proposal must still be listed.
//
// Also proven, because they are what "AI-prepared proposals of this project" means:
//   - a typed message waiting for a confirm, an already approved proposal, a proposal of another project and a
//     prepared chain naming another function are not listed;
//   - no project-side cost field is listed, though the stored chain keeps it;
//   - another organisation's project, and a project a project-pinned key may not reach, read as absent (404);
//   - a session below member is refused (403) and an unauthenticated call gets the guard's own 401.
//
// WHAT IS REAL: the route, prepared-proposals.ts, email-intelligence-service.ts, submitForVerdict,
// proposeSubmission, the dry run, Level 0, the provider gate, requireRoleOrScope, function-registry.ts.
// WHAT IS FAKED: @/lib/db/tenant-scoped, by src/lib/pipeline/__test-helpers__/boq-store-double.ts (it evaluates the
// real compiled where clauses against fixture rows and commits a transaction's writes only when it resolves),
// requireAuthOrApiKey (the identity), and the task engine's executeTask (the email path never reaches it for a BOQ
// suggestion).
//
// Run: bun test --isolate "src/app/api/v1/projexa/projects/[id]/approvals/route.test.ts"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore } from "@/lib/pipeline/__test-helpers__/boq-store-double"
import { normaliseForMatch } from "@/lib/pipeline/classify"

const ORG = "org_1"
const OTHER_ORG = "org_2"
const PROJECT_A = "project_a"
const PROJECT_B = "project_b"
const PROJECT_OTHER_ORG = "project_x"
const PERSON = "person_1"
const ITEM = "eii_1"

let store: BoqStore
let identity: { dbUser: Record<string, unknown> | null; apiKey: Record<string, unknown> | null; response?: Response | null }

const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }))

const realAuthGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => (identity.response ? { orgId: null, dbUser: null, apiKey: null, response: identity.response } : { orgId: ORG, response: null, ...identity })),
}))

const realEngine = await import("@/lib/task-execution-engine")
mock.module("@/lib/task-execution-engine", () => ({ ...realEngine, executeTask: async () => ({ success: true }) }))

let GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let service: typeof import("@/lib/services/email-intelligence-service")
beforeAll(async () => {
  ;({ GET } = (await import("./route")) as unknown as { GET: typeof GET })
  service = await import("@/lib/services/email-intelligence-service")
})

const dbUser = { id: PERSON, orgId: ORG, name: "Asha M", email: "asha@example.test", role: "manager", isActive: true }
const session = () => ({ dbUser, apiKey: null })

/** The BOQ line suggestion as analyzeInboundEmail stores it. */
const BOQ_SUGGESTION = {
  title: "Add BOQ line: Excavation in ordinary soil",
  category: "boq_line_item",
  assignee: null,
  dueDateHint: null,
  boqLineItem: { projectId: PROJECT_A, boqTitle: "Villa 21 - Tender BOQ", itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450 },
}

function fixtures(withPhrase: boolean): BoqStore {
  const s = makeBoqStore()
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_B, orgId: ORG, name: "Lakeview" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere" },
  ])
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.test" }])
  if (withPhrase) {
    seedRows(s, "phrase_map", [{ orgId: ORG, normalisedPhrase: normaliseForMatch("new boq"), functionId: "create_boq", fixedParams: null, promotedAt: new Date() }])
  }
  seedRows(s, "email_intelligence_items", [
    { id: ITEM, orgId: ORG, submittedById: PERSON, subject: "BOQ for Villa 21", senderEmail: "site@vendor.test", body: "Please add excavation.", status: "proposed", aiSuggestedWorkItems: [BOQ_SUGGESTION] },
  ])
  return s
}

const preparedChain = (over: Record<string, unknown> = {}) => ({
  source: "email_intelligence",
  functionId: "create_boq",
  params: { projectId: PROJECT_A, title: "Seeded BOQ", lineItems: [{ description: "Seeded line", unit: "nos", quantity: 2, rate: 10 }] },
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
  store = fixtures(true)
  identity = session()
  for (const k of ENV_KEYS) delete process.env[k]
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
  await mock.module("@/lib/task-execution-engine", () => realEngine)
})

const ctx = () => ({ orgId: ORG, userId: PERSON, dbUser: dbUser as never })
const promote = () => service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 0 }) as Promise<{ proposal: { submissionId: string; staged: boolean } }>
const list = (projectId = PROJECT_A) =>
  GET(new Request(`https://x/api/v1/projexa/projects/${projectId}/approvals`), { params: Promise.resolve({ id: projectId }) })

describe("BR-409: GET /projects/[id]/approvals lists the AI-prepared BOQ line-item proposals", () => {
  test("*** THE ROW: 200, 1 proposal made by the email bridge, 1 approve action for it, and nothing written ***", async () => {
    const { proposal } = await promote()
    expect(proposal.staged).toBe(true)
    const [stored] = rowsOf(store, "submissions")
    expect(stored.status).toBe("in_progress")
    const before = JSON.stringify(store.tables)

    const res = await list()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.projectId).toBe(PROJECT_A)
    expect(body.count).toBe(1)
    expect(body.proposals).toHaveLength(1)
    const [p] = body.proposals
    // Compared with the stored row, not with the return value of the promote call.
    expect(p.submissionId).toBe(stored.id)
    expect([p.source, p.functionId, p.label, p.preparedById]).toEqual(["email_intelligence", "create_boq", "New BOQ", PERSON])
    expect(p.params).toEqual({
      projectId: PROJECT_A,
      title: "Villa 21 - Tender BOQ",
      lineItems: [{ itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450 }],
    })
    expect(p.missing).toEqual([])
    // One approve action, and it names the route that confirms this very submission.
    expect(p.approve).toEqual({ action: "approve", method: "POST", path: `/api/v1/projexa/projects/${PROJECT_A}/approvals`, body: { submissionId: stored.id } })
    // Read only: every table is byte for byte what it was, and every where clause was evaluated for real.
    expect(JSON.stringify(store.tables)).toBe(before)
    expect(rowsOf(store, "construction_boq_line_items")).toHaveLength(0)
    expect(store.unparsed).toEqual([])
  })

  test("the live state (no phrase for create_boq, the model refused): the proposal is stored as chat and is still listed", async () => {
    store = fixtures(false)
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli"
    process.env.RAJAT_USER_ID = "someone_else"

    const { proposal } = await promote()
    const [stored] = rowsOf(store, "submissions")
    // The words did not resolve, so the dry run had nothing to propose and the row is not "in progress".
    expect(proposal.staged).toBe(false)
    expect(stored.status).toBe("chat")

    const body = await (await list()).json()

    expect(body.count).toBe(1)
    expect(body.proposals[0].submissionId).toBe(stored.id)
    expect(body.proposals[0].params.lineItems).toHaveLength(1)
    expect(body.proposals[0].approve.body).toEqual({ submissionId: stored.id })
  })

  test("only this project's pending prepared proposals are listed, newest first", async () => {
    seedRows(store, "submissions", [
      submissionRow({ id: "sub_old", selectedChain: preparedChain({ params: { projectId: PROJECT_A, title: "Older", lineItems: [] } }), createdAt: new Date("2026-09-20T10:00:00Z") }),
      submissionRow({ id: "sub_new", selectedChain: preparedChain({ source: "paste_back", params: { projectId: PROJECT_A, title: "Newer", lineItems: [] } }), createdAt: new Date("2026-09-24T10:00:00Z") }),
      // not listed: a typed message waiting for a confirm (its chain is the client's hint)
      submissionRow({ id: "sub_typed", rawInput: "record 40 percent on 1.01", selectedChain: { mode: "Projects", verb: "record" } }),
      submissionRow({ id: "sub_typed_no_chain", rawInput: "show me the dashboard", selectedChain: null }),
      // not listed: decided (done, failed) even though the row still carries the prepared chain
      submissionRow({ id: "sub_done", status: "done" }),
      submissionRow({ id: "sub_failed", status: "failed" }),
      // not listed: another project, another organisation
      submissionRow({ id: "sub_other_project", projectId: PROJECT_B }),
      submissionRow({ id: "sub_other_org", orgId: OTHER_ORG }),
      // not listed: a prepared chain naming a function this list does not approve, an unknown source, no params
      submissionRow({ id: "sub_other_fn", selectedChain: preparedChain({ functionId: "record_work_progress" }) }),
      submissionRow({ id: "sub_other_source", selectedChain: preparedChain({ source: "somewhere_else" }) }),
      submissionRow({ id: "sub_no_params", selectedChain: { source: "paste_back", functionId: "create_boq" } }),
    ])

    const body = await (await list()).json()

    expect(body.proposals.map((p: { submissionId: string }) => p.submissionId)).toEqual(["sub_new", "sub_old"])
    expect(body.proposals.map((p: { params: { title: string } }) => p.params.title)).toEqual(["Newer", "Older"])
    expect(body.proposals.map((p: { source: string }) => p.source)).toEqual(["paste_back", "email_intelligence"])
    // Every proposal carries exactly one approve action, pointing at its own submission.
    for (const p of body.proposals) expect(p.approve.body.submissionId).toBe(p.submissionId)
    // The other project lists its own.
    const other = await (await list(PROJECT_B)).json()
    expect(other.proposals.map((p: { submissionId: string }) => p.submissionId)).toEqual(["sub_other_project"])
  })

  test("a proposal still missing a required parameter says which (the person adds it when approving)", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_no_title", selectedChain: preparedChain({ params: { projectId: PROJECT_A, lineItems: [] } }) })])

    const body = await (await list()).json()

    expect(body.proposals[0].missing).toEqual([{ name: "title", label: "Title", code: "TITLE_REQUIRED" }])
  })

  test("no project-side cost field is listed, though the stored chain keeps it", async () => {
    const line = { description: "Slab", unit: "cum", quantity: 4, rate: 9000, qtyProject: 5, rateProject: 7000, qtyContract: 4, rateContract: 9000 }
    seedRows(store, "submissions", [submissionRow({ id: "sub_cost", selectedChain: preparedChain({ params: { projectId: PROJECT_A, title: "Costs", lineItems: [line] } }) })])

    const body = await (await list()).json()

    const listed = body.proposals[0].params.lineItems[0]
    expect(listed).toEqual({ description: "Slab", unit: "cum", quantity: 4, rate: 9000, qtyContract: 4, rateContract: 9000 })
    expect(listed.qtyProject).toBeUndefined()
    expect(listed.rateProject).toBeUndefined()
    // The read did not change the stored chain: the approval still writes what was prepared.
    expect((rowsOf(store, "submissions")[0].selectedChain as { params: { lineItems: unknown[] } }).params.lineItems[0]).toEqual(line)
  })

  test("a project with nothing prepared answers 200 with an empty list, not an error", async () => {
    const res = await list(PROJECT_B)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projectId: PROJECT_B, count: 0, proposals: [] })
  })
})

describe("BR-409: who can read the list", () => {
  test("a project that does not exist, and another organisation's project, are 404 and list nothing", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_x", projectId: PROJECT_OTHER_ORG, orgId: OTHER_ORG })])
    for (const id of ["no_such_project", PROJECT_OTHER_ORG]) {
      const res = await list(id)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe("Project not found")
      expect(body.proposals).toBeUndefined()
    }
  })

  test("a project-pinned key reads its own project and gets a 404 for any other, existing or not", async () => {
    seedRows(store, "submissions", [submissionRow({ id: "sub_a" }), submissionRow({ id: "sub_b", projectId: PROJECT_B })])
    identity = { dbUser: null, apiKey: { id: "key_1", name: "AI key", scopes: ["read"], keyKind: "project_ai", projectId: PROJECT_A } }

    const own = await list(PROJECT_A)
    expect(own.status).toBe(200)
    expect((await own.json()).proposals.map((p: { submissionId: string }) => p.submissionId)).toEqual(["sub_a"])

    for (const id of [PROJECT_B, "no_such_project"]) {
      const res = await list(id)
      expect(res.status).toBe(404)
      expect((await res.json()).proposals).toBeUndefined()
    }
  })

  test("an org-wide key with the read scope may read; one without it is refused (403)", async () => {
    identity = { dbUser: null, apiKey: { id: "key_2", name: "Service key", scopes: ["read"], keyKind: "org_service", projectId: null } }
    expect((await list()).status).toBe(200)

    identity = { dbUser: null, apiKey: { id: "key_3", name: "No scope", scopes: [], keyKind: "org_service", projectId: null } }
    expect((await list()).status).toBe(403)
  })

  test("a session below member is refused (403); no authentication gets the guard's own 401", async () => {
    identity = { dbUser: { ...dbUser, role: "viewer" }, apiKey: null }
    expect((await list()).status).toBe(403)

    identity = { dbUser: null, apiKey: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) }
    expect((await list()).status).toBe(401)
  })
})
