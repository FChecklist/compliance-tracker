/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-15 (register row AW-606, the part of it a database can prove): the ZOOMIES workbook, put into PROJEXA by three
// different ways, leaves the SAME project in the SAME tables, and every row is attributed to a real person.
//
//   way 1  a person uploads the file: POST /api/v1/projexa/projects/from-document (the file), then again with acknowledgeQuestions
//   way 2  the internal chat with the file attached: runChatAttachment(), propose then confirm, on the REAL createProjectFromDocument
//          with the REAL ledger, createProject and createBoq (only the stored-file read is a stand-in that hands over the bytes)
//   way 4  the file arrived by email: the parked job is approved by its id through the same route
//
// Way 3 (an external AI through the link) is run by scripts/verify/way3-zoomies.sh and re-reads the same figures from its own tables.
// Way 5 (a scheduler scanning a folder) ends in a parked proposal by design and creates no project, so it has no project to reconcile
// (WP-13, AW-605; an approve action for it is the owner's decision D-1). ways-reconcile.sh says so and runs both.
//
// WHAT IS PROVEN, each figure read back from the tables of real Postgres (PGlite), not from a response body:
//   1. after each way: 1 project, 1 BOQ, 53 lines, the lines add up to AED 1,596,280 (sum of quantity x rate);
//   2. attribution: the project's lead and the BOQ's creator are the acting person, and that person is a real row of compliance.users;
//      any created_by-style column on a line is filled with a real person too;
//   3. across ways: the three BOQs hold the same 53 lines (item code, unit, quantity, rate), and each way used the model once.
//
// Run: bun test --isolate src/lib/services/ways-reconcile.pglite.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import * as realNext from "next/server"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import * as realAuthGuard from "@/lib/supabase/auth-guard"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"
import { insertProduct, insertUser } from "@/lib/services/__test-helpers__/document-extraction-pglite"
import { createEmailIntakePglite, insertAttachment } from "@/lib/services/__test-helpers__/email-intake-pglite"
import { SHARED_SECRET, edgeDeps } from "@/lib/services/__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "@/lib/services/__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "@/lib/services/__test-helpers__/zoomies-workbook"
import { handleProjexaDocumentExtract, type ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"
import { createInternalExtractCaller, type GatewayModelCall } from "@/lib/ai/internal-model-gateway"
import type { InternalAiRoute } from "@/lib/ai/internal-ai-policy"
import { extractionDepsWith } from "@/lib/pipeline/executors/extraction"
import { runChatAttachment, type ChatAttachmentDeps, type ChatAttachmentInput } from "@/lib/pipeline/chat-attachment"

const ORG = "org-reconcile"
const PERSON = "user-1"
const PRODUCT = "product-construction"
const MESSAGE = "message-reconcile-1"
const BASE_URL = "https://ref.supabase.test"
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const ZOOMIES = zoomiesWorkbook()
const TOTAL = 1_596_280
const METERED: InternalAiRoute = { allowed: true, kind: "metered", provider: "openrouter", providerCostType: "METERED_API", rebillable: true }

let h: Awaited<ReturnType<typeof createEmailIntakePglite>>
let POST: (request: never) => Promise<Response>
let prepareEmailProposals: typeof import("@/lib/services/email-attachment-intake").prepareEmailProposals
const seen = { modelCalls: 0 }

let depth = 0
async function tenantDouble<T>(_ctx: unknown, fn: (tx: never) => Promise<T>): Promise<T> {
  if (depth > 0) throw new Error("nested withTenantContext (the real one refuses this too)")
  depth++
  try {
    return await h.db.transaction((tx) => fn(tx as never))
  } finally {
    depth--
  }
}

const realFetch = globalThis.fetch
const savedEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET }

/** The model every way uses: the careful stand-in, counted. */
const counted: ModelCall = async (req) => {
  seen.modelCalls++
  return carefulHumanModel(req)
}

beforeAll(async () => {
  h = await createEmailIntakePglite()
  await insertProduct(h, { id: PRODUCT, org_id: ORG })
  await insertUser(h, { id: PERSON, org_id: ORG })

  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tenantDouble }))
  mock.module("next/server", () => ({ ...realNext, after: (_fn: () => Promise<void>) => undefined }))
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...realAuthGuard,
    ...actingPersonDouble(() => null),
    requireAuthOrApiKey: mock(async () => ({ orgId: ORG, dbUser: { id: PERSON }, apiKey: null, response: null })),
    requireRoleOrScope: mock(() => null),
  }))

  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE_URL
  process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET = SHARED_SECRET
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    if (!target.startsWith(`${BASE_URL}/functions/v1/projexa-document-extract`)) throw new Error(`unexpected fetch to ${target}`)
    return handleProjexaDocumentExtract(new Request(target, init), edgeDeps(counted))
  }) as typeof fetch

  const route = await import("@/app/api/v1/projexa/projects/from-document/route")
  POST = route.POST as unknown as typeof POST
  prepareEmailProposals = (await import("@/lib/services/email-attachment-intake")).prepareEmailProposals
}, 60_000)

afterAll(async () => {
  globalThis.fetch = realFetch
  if (savedEnv.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = savedEnv.url
  if (savedEnv.secret === undefined) delete process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET
  else process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET = savedEnv.secret
  await h.pg.close()
})

beforeEach(async () => {
  await h.pg.exec(
    "truncate compliance.projects, compliance.construction_boqs, compliance.construction_boq_line_items, compliance.source_object, compliance.inbound_email_attachments",
  )
  seen.modelCalls = 0
  depth = 0
})

type Row = Record<string, unknown>
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await h.pg.query(sql, params)).rows as Row[]
const count = async (table: string) => Number((await rows(`select count(*)::int as n from compliance.${table}`))[0].n)

/** One snapshot of what a way left in the tables, read back with SQL. */
async function snapshot() {
  const counts = { projects: await count("projects"), boqs: await count("construction_boqs"), lines: await count("construction_boq_line_items") }
  const total = Number((await rows("select coalesce(sum(quantity * rate), 0)::numeric as t from compliance.construction_boq_line_items"))[0].t)
  const project = (await rows("select id, lead_user_id from compliance.projects"))[0]
  const boq = (await rows("select project_id, created_by_id from compliance.construction_boqs"))[0]
  const people = new Set((await rows("select id from compliance.users")).map((r) => String(r.id)))
  // A line has no author column of its own in some schemas; where any created_by-style column exists it must hold a real person.
  const authorCols = (
    await rows("select column_name from information_schema.columns where table_schema = 'compliance' and table_name = 'construction_boq_line_items' and column_name like '%created_by%'")
  ).map((r) => String(r.column_name))
  const unattributedLines = authorCols.length
    ? Number((await rows(`select count(*)::int as n from compliance.construction_boq_line_items where ${authorCols.map((c) => `(${c} is null or ${c} not in (select id from compliance.users))`).join(" or ")}`))[0].n)
    : 0
  const lines = (
    await rows("select item_code, coalesce(unit, '') as unit, quantity::float8 as quantity, rate::float8 as rate from compliance.construction_boq_line_items order by item_code, coalesce(unit, ''), quantity, rate")
  ).map((r) => `${r.item_code}|${r.unit}|${r.quantity}|${r.rate}`)
  return { counts, total, project, boq, people, authorCols, unattributedLines, lines }
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>
const results: Record<string, Snapshot> = {}

function expectReconciled(s: Snapshot) {
  expect(s.counts).toEqual({ projects: 1, boqs: 1, lines: 53 })
  expect(Math.round(s.total * 100) / 100).toBe(TOTAL)
  expect(s.project.lead_user_id).toBe(PERSON)
  expect(s.people.has(String(s.project.lead_user_id))).toBe(true)
  expect(s.boq.created_by_id).toBe(PERSON)
  expect(s.people.has(String(s.boq.created_by_id))).toBe(true)
  expect(s.boq.project_id).toBe(s.project.id)
  expect(s.unattributedLines).toBe(0)
  expect(seen.modelCalls).toBe(1)
}

function postFile(fields: Record<string, string>) {
  const form = new FormData()
  form.set("file", new File([new Uint8Array(ZOOMIES)], "SMD ZOOMIES.xlsx", { type: XLSX_TYPE }))
  form.set("productId", PRODUCT)
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request("http://localhost/api/v1/projexa/projects/from-document", { method: "POST", body: form }) as never
}
function postJob(fields: Record<string, string>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request("http://localhost/api/v1/projexa/projects/from-document", { method: "POST", body: form }) as never
}

describe("AW-606: three ways, one project", () => {
  test("way 1, upload: the file is read, the questions are acknowledged, and the tables hold 53 lines adding up to AED 1,596,280, attributed to the person", async () => {
    const parked = await POST(postFile({}))
    expect(parked.status).toBe(200)
    expect(await parked.json()).toMatchObject({ duplicate: false, state: "needs_answers" })
    expect(await count("projects")).toBe(0)

    const created = await POST(postFile({ acknowledgeQuestions: "true" }))
    expect(created.status).toBe(201)
    expectReconciled((results.way1 = await snapshot()))
  })

  test("way 2, internal chat: propose creates nothing, confirm creates the project, and the tables hold the same figures, attributed to the person", async () => {
    const caller = createInternalExtractCaller({
      route: METERED,
      orgId: ORG,
      personId: PERSON,
      model: (async (req) => {
        seen.modelCalls++
        const answer = await carefulHumanModel({ system: req.system, user: req.user, maxOutputChars: req.maxOutputChars })
        const text = typeof answer === "string" ? answer : answer.text
        return { text, usage: { promptTokens: Math.ceil(req.user.length / 4), completionTokens: Math.ceil(text.length / 4) }, model: "stand-in-model", usageEstimated: false }
      }) as GatewayModelCall,
      meter: async () => {},
      log: () => {},
    })
    const real = extractionDepsWith(caller)
    const deps: ChatAttachmentDeps = {
      resolveRoute: () => METERED,
      buildExecutorDeps: () => ({
        modelCalls: () => caller.calls.count,
        // the REAL run (ledger, createProject, createBoq); only the read of the stored file hands over the bytes
        deps: { run: real.run, readDocument: async () => ({ fileName: "SMD ZOOMIES.xlsx", bytes: new Uint8Array(ZOOMIES) }) },
      }),
    }
    const base: ChatAttachmentInput = {
      orgId: ORG, keyUserId: "key-1", personId: PERSON, role: "manager", rawInput: "create a project from this",
      attachment: { documentId: "doc-1", sha256: null }, productId: PRODUCT, projectName: null,
      confirm: false, acknowledgeQuestions: false, acknowledgeShortfall: false,
    }
    const proposed = await runChatAttachment(base, deps)
    expect(proposed).toMatchObject({ stage: "propose", status: "needs_answers", projectId: null, failure: null })
    expect(await count("projects")).toBe(0)

    const confirmed = await runChatAttachment({ ...base, confirm: true, acknowledgeQuestions: true }, deps)
    expect(confirmed).toMatchObject({ stage: "confirm", status: "created", failure: null })
    expect(confirmed.projectId).toBeTruthy()
    expectReconciled((results.way2 = await snapshot()))
  })

  test("way 4, email: the emailed job is approved by its id and the tables hold the same figures, attributed to the person", async () => {
    await insertAttachment(h, { id: "att-z", org_id: ORG, message_id: MESSAGE, file_name: "SMD ZOOMIES.xlsx", content: ZOOMIES })
    const prepared = await prepareEmailProposals({ orgId: ORG, person: { id: PERSON }, inboundMessageId: MESSAGE })
    expect(prepared.outcomes[0]).toMatchObject({ result: "prepared", state: "needs_answers" })
    const jobId = (prepared.outcomes[0] as { jobId: string }).jobId
    expect(await count("projects")).toBe(0)

    const created = await POST(postJob({ jobId, productId: PRODUCT, acknowledgeQuestions: "true" }))
    expect(created.status).toBe(201)
    expectReconciled((results.way4 = await snapshot()))
  })

  test("the three ways left the same 53 lines: item code, unit, quantity and rate all equal", () => {
    expect(Object.keys(results).sort()).toEqual(["way1", "way2", "way4"])
    expect(results.way1.lines).toHaveLength(53)
    expect(results.way2.lines).toEqual(results.way1.lines)
    expect(results.way4.lines).toEqual(results.way1.lines)
    expect(results.way2.total).toBe(results.way1.total)
    expect(results.way4.total).toBe(results.way1.total)
  })
})
