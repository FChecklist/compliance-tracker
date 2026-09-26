/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-12 (AW-604 through the route): the open list and the approval of a proposal that an inbound email left behind.
//
// WHAT RUNS FOR REAL. The route, prepareEmailProposals() with its real dependencies (the stored attachment read from the database, the
// real Edge Function handler behind a stubbed fetch with the stand-in model, the real extraction ledger), loadEmailJobFile(), and the real
// createProject() and createBoq() on PGlite. WHAT IS REPLACED. The authentication guard (a double that reads the real request headers),
// withTenantContext's connection, and next/server's after(). Every count is read back from the tables.
//
// WHAT IS PROVEN
//   1. GET ?open=1 lists the emailed job (origin email, state needs_answers, its questions, where its file is, the approve action) and
//      nothing of another organisation.
//   2. POST with the job id and a product and NO file: without acknowledgeQuestions the answer is 200 needs_answers and nothing is created;
//      with it, 201: a project and 53 lines that add up to AED 1,596,280, the file read from the stored attachment, no second model call.
//      Afterwards the open list is empty and the same job id is 404.
//   3. A job id that is unknown, or belongs to another organisation, is 404 job_not_found and creates nothing; neither a file nor a job id
//      is still 400 no_file.
//   4. GET ?open=1 asks the same role floor as the rest of the route (member, read scope) and refuses a project key.
//
// Run: bun test --isolate src/app/api/v1/projexa/projects/from-document/route.email-job.test.ts
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
import { handleProjexaDocumentExtract, type ModelCall } from "../../../../../../../supabase/functions/projexa-document-extract/handler"

const ORG = "org-email-route"
const OTHER_ORG = "org-email-route-2"
const PRODUCT = "product-construction"
const MESSAGE = "message-route-1"
const BASE_URL = "https://ref.supabase.test"
const ZOOMIES = zoomiesWorkbook()

let h: Awaited<ReturnType<typeof createEmailIntakePglite>>
let POST: (request: never) => Promise<Response>
let GET: (request: never) => Promise<Response>
let prepareEmailProposals: typeof import("@/lib/services/email-attachment-intake").prepareEmailProposals

type Auth = { orgId: string | null; keyKind?: "org_service" | "project_ai"; roleErr?: Response | null }
let auth: Auth = { orgId: ORG }
const roleGuard = mock((_ctx: unknown, _minRole: string, _scope: string) => auth.roleErr ?? null)
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
const model: ModelCall = carefulHumanModel

beforeAll(async () => {
  h = await createEmailIntakePglite()
  await insertProduct(h, { id: PRODUCT, org_id: ORG })
  await insertUser(h, { id: "user-1", org_id: ORG })

  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tenantDouble }))
  mock.module("next/server", () => ({ ...realNext, after: (_fn: () => Promise<void>) => undefined }))
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...realAuthGuard,
    ...actingPersonDouble(() => null),
    requireAuthOrApiKey: mock(async () => ({
      orgId: auth.orgId,
      dbUser: auth.orgId ? { id: "user-1" } : null,
      apiKey: auth.keyKind ? { id: "key-1", name: "PROJEXA org key", scopes: ["read", "write"], keyKind: auth.keyKind, projectId: auth.keyKind === "project_ai" ? "project-9" : null } : null,
      response: null,
    })),
    requireRoleOrScope: roleGuard,
  }))

  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE_URL
  process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET = SHARED_SECRET
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    if (!target.startsWith(`${BASE_URL}/functions/v1/projexa-document-extract`)) throw new Error(`unexpected fetch to ${target}`)
    const counted: ModelCall = async (req) => {
      seen.modelCalls++
      return model(req)
    }
    return handleProjexaDocumentExtract(new Request(target, init), edgeDeps(counted))
  }) as typeof fetch

  const route = await import("./route")
  POST = route.POST as unknown as typeof POST
  GET = route.GET as unknown as typeof GET
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
  auth = { orgId: ORG }
  roleGuard.mockClear()
  seen.modelCalls = 0
  depth = 0
})

const count = async (table: string) => Number(((await h.pg.query(`select count(*)::int as n from compliance.${table}`)).rows[0] as { n: number }).n)
const tableCounts = async () => ({ projects: await count("projects"), boqs: await count("construction_boqs"), lines: await count("construction_boq_line_items") })
const get = (query: string) => new Request(`http://localhost/api/v1/projexa/projects/from-document${query}`, { method: "GET" }) as never
function postJob(fields: Record<string, string>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request("http://localhost/api/v1/projexa/projects/from-document", { method: "POST", body: form }) as never
}

/** An email with the ZOOMIES workbook arrived and its intake has run: the emailed job, as the webhook leaves it. Returns the job id. */
async function emailedJob(): Promise<string> {
  await insertAttachment(h, { id: "att-z", org_id: ORG, message_id: MESSAGE, file_name: "SMD ZOOMIES.xlsx", content: ZOOMIES })
  const result = await prepareEmailProposals({ orgId: ORG, person: { id: "user-1" }, inboundMessageId: MESSAGE })
  expect(result.outcomes[0]).toMatchObject({ result: "prepared", state: "needs_answers" })
  return (result.outcomes[0] as { jobId: string }).jobId
}

describe("AW-604: the list of proposals that wait for a person shows the emailed job", () => {
  test("*** GET ?open=1: the emailed job with its questions, its origin, where its file is and the approve action ***", async () => {
    const jobId = await emailedJob()
    const res = await GET(get("?open=1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.jobs[0]).toMatchObject({
      jobId,
      state: "needs_answers",
      origin: "email",
      fileName: "SMD ZOOMIES.xlsx",
      via: { channel: "email", inboundMessageId: MESSAGE, attachmentId: "att-z" },
      reconciliation: { status: "matched", expected: 1_596_280 },
      approve: { method: "POST", path: "/api/v1/projexa/projects/from-document", form: { jobId } },
    })
    expect(body.jobs[0].questions).toHaveLength(27)
    expect(JSON.stringify(body)).not.toContain("lineItems")
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })
    expect(roleGuard).toHaveBeenCalledWith(expect.anything(), "member", "read")
  })

  test("another organisation sees an empty list", async () => {
    await emailedJob()
    auth = { orgId: OTHER_ORG }
    const body = await (await GET(get("?open=1"))).json()
    expect(body).toEqual({ count: 0, jobs: [] })
  })

  test("a project key is refused, and the role floor is the route's own", async () => {
    auth = { orgId: ORG, keyKind: "project_ai" }
    expect((await GET(get("?open=1"))).status).toBe(403)
    auth = { orgId: ORG, roleErr: Response.json({ error: "Forbidden" }, { status: 403 }) }
    expect((await GET(get("?open=1"))).status).toBe(403)
  })
})

describe("AW-604: the person approves the emailed proposal by its job id; only then is a project created", () => {
  test("without acknowledgeQuestions the job still waits: 200 needs_answers, nothing created, no second model call", async () => {
    const jobId = await emailedJob()
    const res = await POST(postJob({ jobId, productId: PRODUCT }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ duplicate: false, state: "needs_answers", jobId })
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })
    expect(seen.modelCalls).toBe(1)
  })

  test("*** with acknowledgeQuestions: 201 created, a project and 53 lines that add up to the file's total, the file read from the stored attachment, one model call in all ***", async () => {
    const jobId = await emailedJob()
    const res = await POST(postJob({ jobId, productId: PRODUCT, acknowledgeQuestions: "true" }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ duplicate: false, state: "created", extraction: { lines: 53 }, reconciliation: { status: "matched", expected: 1_596_280 } })
    expect(seen.modelCalls).toBe(1)
    expect(await tableCounts()).toMatchObject({ projects: 1, boqs: 1, lines: 53 })
    const total = (await h.pg.query("select sum(quantity * rate)::numeric as t from compliance.construction_boq_line_items")).rows[0] as { t: string }
    expect(Number(total.t)).toBe(1_596_280)

    expect((await (await GET(get("?open=1"))).json()).count).toBe(0)
    expect(await (await GET(get(`?jobId=${jobId}`))).json()).toMatchObject({ state: "created", projectId: body.projectId, origin: "email" })
    // The job is decided: its id no longer names a proposal that waits.
    const again = await POST(postJob({ jobId, productId: PRODUCT, acknowledgeQuestions: "true" }))
    expect(again.status).toBe(404)
    expect(await tableCounts()).toMatchObject({ projects: 1, boqs: 1, lines: 53 })
  })

  test("an unknown job id and another organisation's job id are 404 job_not_found and create nothing", async () => {
    const jobId = await emailedJob()
    const unknown = await POST(postJob({ jobId: "no-such-job", productId: PRODUCT, acknowledgeQuestions: "true" }))
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: "job_not_found" })
    auth = { orgId: OTHER_ORG }
    const foreign = await POST(postJob({ jobId, productId: PRODUCT, acknowledgeQuestions: "true" }))
    expect(foreign.status).toBe(404)
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })
  })

  test("neither a file nor a job id is still 400 no_file; a job id still needs a product", async () => {
    const none = await POST(postJob({ productId: PRODUCT }))
    expect(none.status).toBe(400)
    expect(await none.json()).toMatchObject({ code: "no_file" })
    const noProduct = await POST(postJob({ jobId: "x" }))
    expect(noProduct.status).toBe(400)
    expect(await noProduct.json()).toMatchObject({ code: "product_required" })
  })
})
