/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-11 (AW-602, way 2): POST /api/v1/projexa/assistant with an attachment. The REAL route, the REAL orchestrator
// (pipeline/chat-attachment.ts), the REAL executor and its REAL document read (readStoredDocument), the REAL provider policy and the
// REAL metered caller run; the stand-ins are the auth context, the tenant transaction (a depth tracker), the storage download, the
// model (the careful stand-in of the WP-02 helpers) and the usage ledger's write (a spy). The service behind the executor is the
// REAL createProjectFromDocument() on the in-memory ledger, each of whose ledger operations opens a tracked transaction, and whose
// model caller is invoked from INSIDE an open transaction: the worst case for the nested-withTenantContext fault
// (assertNotNested throws in dev and test, and in production silently opens a second connection).
//
// WHAT IS PROVEN
//   1. propose answers 200 with the questions in words, a proposal and the job key; confirm answers 201; the first creates nothing.
//   2. The transaction is never opened while another is open (max depth 1) even though the model caller runs inside one: the gateway
//      and the orchestrator open none of their own.
//   3. The model call was metered: one ledger write for this organisation and person, product_orchestra, METERED_API.
//   4. A key for one project is 403 (this makes a NEW project); a bad attachment is 400; a key that names no person is a refused
//      answer (200, fixed sentence) and reads nothing; a role failure is the guard's own response; a deployment with no metered
//      provider is a refused answer and reads nothing.
//   5. A request with no attachment still goes to the text pipeline, and one with an attachment never does.
//
// Run: bun test --isolate src/app/api/v1/projexa/assistant/route.attachment.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { memoryLedger } from "@/lib/services/__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "@/lib/services/__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "@/lib/services/__test-helpers__/zoomies-workbook"
import type { LogTokenUsageInput } from "@/lib/services/token-usage-service"

const ORG = "org-1"
const PERSON = "person-1"
const ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_ALLOWED_PROVIDERS", "OPENROUTER_API_KEY", "INTERNAL_AI_ALLOW_CLAUDE_CLI", "RAJAT_USER_ID"] as const
const SAVED = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>

type AuthState = { dbUser: { id: string; role: string } | null; apiKey: Record<string, unknown> | null; roleErr: Response | null }
const state = {
  auth: { dbUser: { id: PERSON, role: "member" }, apiKey: null, roleErr: null } as AuthState,
  bytes: new Uint8Array(),
  depth: 0,
  maxDepth: 0,
  opened: 0,
  usage: [] as LogTokenUsageInput[],
  submissions: 0,
  memory: memoryLedger(),
  created: { projects: 0, boqs: 0, lines: 0 },
  modelCalls: 0,
}

// ---- mocks, all before the route is imported ----------------------------------------------------------------------------------

const realAuthGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: async () => ({ orgId: ORG, dbUser: state.auth.dbUser, apiKey: state.auth.apiKey, response: null }),
  requireRoleOrScope: () => state.auth.roleErr,
}))

async function tracked<T>(_ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T> {
  state.opened++
  state.depth++
  state.maxDepth = Math.max(state.maxDepth, state.depth)
  try {
    return await fn({ query: { documents: { findFirst: async () => ({ id: "doc-1", name: "zoomies.xlsx", fileUrl: "org-1/zoomies.xlsx", fileSize: 1000, metadata: {} }) } } })
  } finally {
    state.depth--
  }
}
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tracked }))

mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => ({ download: async () => ({ data: new Blob([state.bytes]), error: null }) }) } }),
}))

const realToken = await import("@/lib/services/token-usage-service")
mock.module("@/lib/services/token-usage-service", () => ({
  ...realToken,
  recordTokenUsage: async (row: LogTokenUsageInput) => {
    state.usage.push(row)
  },
}))

const realGateway = await import("@/lib/ai/internal-model-gateway")
mock.module("@/lib/ai/internal-model-gateway", () => ({
  ...realGateway,
  modelCallForRoute: () => async (req: { system: string; user: string; maxOutputChars: number }) => {
    state.modelCalls++
    const answer = await carefulHumanModel({ system: req.system, user: req.user, maxOutputChars: req.maxOutputChars })
    const text = typeof answer === "string" ? answer : answer.text
    return { text, usage: { promptTokens: 900, completionTokens: 200 }, model: "stand-in-model", usageEstimated: false }
  },
}))

const realExtraction = await import("@/lib/pipeline/executors/extraction")
const { createProjectFromDocument } = await import("@/lib/services/document-extraction-service")
mock.module("@/lib/pipeline/executors/extraction", () => ({
  ...realExtraction,
  extractionDepsWith: (callEdge: Parameters<typeof realExtraction.extractionDepsWith>[0]) => ({
    // The real document read: it opens one tracked transaction, closes it, and reads storage.
    readDocument: realExtraction.readStoredDocument,
    run: (input: Parameters<ReturnType<typeof realExtraction.extractionDepsWith>["run"]>[0]) => {
      // Every ledger operation opens a tracked transaction, as the real ledger does.
      const inTx = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => (...args: A) => tracked({}, () => fn(...args))
      const l = state.memory.ledger
      const ledger = { claim: inTx(l.claim), attach: inTx(l.attach), release: inTx(l.release), setState: inTx(l.setState), takeParked: inTx(l.takeParked) }
      return createProjectFromDocument(input, {
        // The worst case: the model caller invoked from inside an open transaction.
        callEdge: (body, attribution) => tracked({}, () => callEdge(body, attribution)),
        ledger: ledger as never,
        createProject: (async () => {
          state.created.projects++
          return { id: "project-1" }
        }) as never,
        createBoq: (async (_ctx: unknown, boq: { lineItems: unknown[] }) => {
          state.created.boqs++
          state.created.lines = boq.lineItems.length
          return { id: "boq-1" }
        }) as never,
      })
    },
  }),
}))

const realRunSubmission = await import("@/lib/pipeline/run-submission")
mock.module("@/lib/pipeline/run-submission", () => ({
  ...realRunSubmission,
  runSubmission: async () => {
    state.submissions++
    return { level1Outcome: "not_needed", tasks: [] }
  },
}))

const { POST } = await import("./route")

function post(body: Record<string, unknown>) {
  return POST(new Request("https://x/api/v1/projexa/assistant", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0])
}

const ATTACHMENT = { documentId: "doc-1" }

beforeAll(() => {
  state.bytes = new Uint8Array(zoomiesWorkbook())
})

beforeEach(() => {
  state.auth = { dbUser: { id: PERSON, role: "member" }, apiKey: null, roleErr: null }
  Object.assign(state, { depth: 0, maxDepth: 0, opened: 0, usage: [], submissions: 0, memory: memoryLedger(), created: { projects: 0, boqs: 0, lines: 0 }, modelCalls: 0 })
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.AI_PROVIDER = "openrouter"
  process.env.OPENROUTER_API_KEY = "present"
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED[k]
  }
})

describe("POST /api/v1/projexa/assistant with an attachment", () => {
  test("propose: 200, the questions in words, a proposal to confirm; nothing created; one metered model call; never a nested transaction", async () => {
    const res = await post({ rawInput: "create a project from this", attachment: ATTACHMENT, productId: "product-1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ functionId: "create_project_from_document", level: 2, stage: "propose", status: "needs_answers", billing: "metered", modelCalls: 1, projectId: null })
    expect(body.questions).toHaveLength(27)
    expect(body.chatMessages[0]).toContain("27 questions need your answer")
    expect(body.proposal).toEqual({ functionId: "create_project_from_document", params: { documentId: "doc-1", productId: "product-1" }, requiresConfirmation: true })
    expect(body.jobKey).toMatch(/^[0-9a-f]{64}$/)
    expect(state.created).toEqual({ projects: 0, boqs: 0, lines: 0 })
    expect(state.modelCalls).toBe(1)
    expect(state.usage).toHaveLength(1)
    expect(state.usage[0]).toMatchObject({ scope: "product_orchestra", orgId: ORG, userId: PERSON, providerCostType: "METERED_API", provider: "openrouter", veridianProductId: "projexa_ai" })
    expect(state.submissions).toBe(0)
    // The document read, the ledger claim, the parked state, all sequential; the model caller ran inside one of them.
    expect(state.opened).toBeGreaterThanOrEqual(3)
    expect(state.maxDepth).toBe(1)
  })

  test("confirm: 201 and one project with its one BOQ of 53 lines; the parked job finished with no second model call", async () => {
    await post({ attachment: ATTACHMENT, productId: "product-1" })
    const res = await post({ attachment: ATTACHMENT, productId: "product-1", confirm: true, acknowledgeQuestions: true })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ stage: "confirm", status: "created", projectId: "project-1", route: "/projects/project-1" })
    expect(state.created).toEqual({ projects: 1, boqs: 1, lines: 53 })
    expect(state.modelCalls).toBe(1)
    expect(state.usage).toHaveLength(1)
    expect(state.maxDepth).toBe(1)
  })

  test("only real booleans confirm: the strings true and 1 do not", async () => {
    await post({ attachment: ATTACHMENT, productId: "product-1" })
    for (const confirm of ["true", 1, "yes"]) {
      const res = await post({ attachment: ATTACHMENT, productId: "product-1", confirm, acknowledgeQuestions: "true" })
      expect(res.status).toBe(200)
      expect((await res.json()).stage).toBe("propose")
    }
    expect(state.created.projects).toBe(0)
  })

  test("a key for one project is 403: this makes a new project, and nothing is read", async () => {
    state.auth = { dbUser: null, apiKey: { id: "key-1", keyKind: "project_ai", projectId: "project-9" }, roleErr: null }
    const res = await post({ attachment: ATTACHMENT, productId: "product-1" })
    expect(res.status).toBe(403)
    expect([state.opened, state.usage.length, state.modelCalls]).toEqual([0, 0, 0])
  })

  test("an attachment that is not {documentId, sha256?} is 400", async () => {
    for (const attachment of [null, "doc-1", {}, { documentId: "../etc" }, { documentId: "d", sha256: "x" }]) {
      const res = await post({ attachment, productId: "product-1" })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("attachment_invalid")
    }
    expect(state.opened).toBe(0)
  })

  test("an org key that names no person: a refused answer in a fixed sentence (200), nothing read, no model", async () => {
    state.auth = { dbUser: null, apiKey: { id: "key-1", keyKind: "org_service", projectId: null }, roleErr: null }
    const res = await post({ attachment: ATTACHMENT, productId: "product-1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: "refused", billing: null, failure: { code: "NOT_PERMITTED", context: { reason: "unidentified_actor" } } })
    expect([state.opened, state.usage.length, state.modelCalls]).toEqual([0, 0, 0])
  })

  test("the guard's own response is returned for a role or scope failure", async () => {
    state.auth.roleErr = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    const res = await post({ attachment: ATTACHMENT, productId: "product-1" })
    expect(res.status).toBe(403)
    expect([state.opened, state.usage.length, state.modelCalls]).toEqual([0, 0, 0])
  })

  test("a deployment with no metered provider key: a refused answer, nothing read, no model", async () => {
    delete process.env.OPENROUTER_API_KEY
    const res = await post({ attachment: ATTACHMENT, productId: "product-1" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: "refused", billing: null, failure: { context: { reason: "metered_provider_not_configured" } } })
    expect(body.chatMessages[0]).not.toMatch(/openrouter|key|claude/i)
    expect([state.opened, state.usage.length, state.modelCalls]).toEqual([0, 0, 0])
  })

  test("the owner's subscription is used only with the owner switch: switch off, the metered route serves the owner", async () => {
    process.env.AI_PROVIDER = "claude-cli"
    process.env.RAJAT_USER_ID = PERSON
    const res = await post({ attachment: ATTACHMENT, productId: "product-1" })
    expect((await res.json()).billing).toBe("metered")
    process.env.INTERNAL_AI_ALLOW_CLAUDE_CLI = "1"
    state.memory = memoryLedger()
    const on = await post({ attachment: ATTACHMENT, productId: "product-1" })
    expect((await on.json()).billing).toBe("owner_subscription")
    expect(state.usage.map((u) => u.providerCostType)).toEqual(["METERED_API", "SUBSCRIPTION_ALLOCATED"])
  })

  test("a message with no attachment still goes to the text pipeline, and one with an attachment never does", async () => {
    const text = await post({ rawInput: "show me the dashboard" })
    expect(text.status).toBe(201)
    expect(state.submissions).toBe(1)
    await post({ rawInput: "create a project from this", attachment: ATTACHMENT, productId: "product-1" })
    expect(state.submissions).toBe(1)
  })
})
