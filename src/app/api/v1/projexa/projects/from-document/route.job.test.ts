/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02 (AW-112, AW-114 through the route): the job states of POST/GET /api/v1/projexa/projects/from-document.
//
// WHAT RUNS FOR REAL. The route, the service, the real Edge Function handler behind a stubbed fetch with the stand-in models of
// zoomies-standin-model.ts, and the real createProject() and createBoq() on PGlite (as route.test.ts). WHAT IS REPLACED. The
// authentication guard (a double that reads the real request headers), withTenantContext's connection, and next/server's after(),
// which here queues the job instead of running it after the response, so a test can read the job between the answer and the run.
// Every count below is read back from the tables.
//
// WHAT IS PROVEN
//   1. A ZOOMIES upload with open questions answers 200 needs_answers and creates nothing; GET reads the job by id and by the file's
//      hash; a second POST with acknowledgeQuestions answers 201 created without a second model call.
//   2. A shortfall answers 422 extraction_total_mismatch and creates nothing; with acknowledgeShortfall it answers 201.
//   3. mode=prepare answers 200 ready; a second POST creates.
//   4. ?async=1 answers 202 received at once with a job id, the job reads received, and after the queued run it reads created; a
//      duplicate is answered at once, not queued; a refused job reads rejected with its code.
//   5. The gates: an unknown mode is 400 before anything is claimed; GET wants a job reference, refuses a project key, finds only the
//      caller's organisation's jobs, and asks the same role floor as POST (member, read scope).
//
// Run: bun test --isolate src/app/api/v1/projexa/projects/from-document/route.job.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import * as realNext from "next/server"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import * as realAuthGuard from "@/lib/supabase/auth-guard"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"
import { createExtractionPglite, insertProduct, insertUser } from "@/lib/services/__test-helpers__/document-extraction-pglite"
import { SHARED_SECRET, buildWorkbook, deterministicModel, edgeDeps } from "@/lib/services/__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "@/lib/services/__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "@/lib/services/__test-helpers__/zoomies-workbook"
import { handleProjexaDocumentExtract, type ModelCall } from "../../../../../../../supabase/functions/projexa-document-extract/handler"

const ORG = "org-route-job"
const OTHER_ORG = "org-route-job-2"
const PRODUCT = "product-construction"
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const BASE_URL = "https://ref.supabase.test"
const ZOOMIES = zoomiesWorkbook()
const SHORT_BOOK = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500], ["TOTAL", "", "", "", 9000]] }])
const SMALL_BOOK = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500]] }])

let h: Awaited<ReturnType<typeof createExtractionPglite>>
let POST: (request: never) => Promise<Response>
let GET: (request: never) => Promise<Response>

type Auth = { orgId: string | null; keyKind?: "org_service" | "project_ai"; roleErr?: Response | null }
let auth: Auth = { orgId: ORG }
const roleGuard = mock((_ctx: unknown, _minRole: string, _scope: string) => auth.roleErr ?? null)

let model: ModelCall | null = carefulHumanModel
const seen = { modelCalls: 0 }
let queued: Array<() => Promise<void>> = []

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

beforeAll(async () => {
  h = await createExtractionPglite()
  await insertProduct(h, { id: PRODUCT, org_id: ORG })
  await insertUser(h, { id: "user-1", org_id: ORG })

  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tenantDouble }))
  mock.module("next/server", () => ({ ...realNext, after: (fn: () => Promise<void>) => void queued.push(fn) }))
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
    const counted: ModelCall | null = model
      ? async (req) => {
          seen.modelCalls++
          return model!(req)
        }
      : null
    return handleProjexaDocumentExtract(new Request(target, init), edgeDeps(counted))
  }) as typeof fetch

  const route = await import("./route")
  POST = route.POST as unknown as typeof POST
  GET = route.GET as unknown as typeof GET
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
  await h.pg.exec("truncate compliance.projects, compliance.construction_boqs, compliance.construction_boq_line_items, compliance.source_object")
  auth = { orgId: ORG }
  roleGuard.mockClear()
  model = carefulHumanModel
  seen.modelCalls = 0
  queued = []
  depth = 0
})

type Fields = { bytes?: Uint8Array; fields?: Record<string, string>; query?: string }
function post(f: Fields = {}) {
  const form = new FormData()
  form.set("file", new File([new Uint8Array(f.bytes ?? ZOOMIES)], "book.xlsx", { type: XLSX_TYPE }))
  form.set("productId", PRODUCT)
  for (const [k, v] of Object.entries(f.fields ?? {})) form.set(k, v)
  return new Request(`http://localhost/api/v1/projexa/projects/from-document${f.query ?? ""}`, { method: "POST", body: form }) as never
}
const get = (query: string) => new Request(`http://localhost/api/v1/projexa/projects/from-document${query}`, { method: "GET" }) as never
const count = async (table: string) => Number(((await h.pg.query(`select count(*)::int as n from compliance.${table}`)).rows[0] as { n: number }).n)
const tableCounts = async () => ({ projects: await count("projects"), boqs: await count("construction_boqs"), lines: await count("construction_boq_line_items") })
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

describe("the job states through the route", () => {
  test("open questions: 200 needs_answers and nothing created; GET reads the job by id and by the file's hash", async () => {
    const res = await POST(post())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ duplicate: false, state: "needs_answers", extraction: { sheets: 22, lines: 53 }, reconciliation: { status: "matched", expected: 1_596_280 } })
    expect(body.questions).toHaveLength(27)
    expect(body.projectId).toBeUndefined()
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })

    const byId = await GET(get(`?jobId=${body.jobId}`))
    expect(byId.status).toBe(200)
    expect(await byId.json()).toMatchObject({ jobId: body.jobId, state: "needs_answers", projectId: null, stats: { lines: 53 }, questions: expect.any(Array) })
    const byHash = await (await GET(get(`?sha256=${sha(ZOOMIES)}`))).json()
    expect(byHash).toMatchObject({ jobId: body.jobId, state: "needs_answers" })
    expect(byHash.questions).toHaveLength(27)
    expect(JSON.stringify(byHash)).not.toContain("lineItems")
    expect(roleGuard).toHaveBeenCalledWith(expect.anything(), "member", "read")
  })

  test("a second POST with acknowledgeQuestions=true creates the project and the BOQ with no second model call: 201 created", async () => {
    const first = await (await POST(post())).json()
    expect(seen.modelCalls).toBe(1)
    const res = await POST(post({ fields: { acknowledgeQuestions: "true" } }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ duplicate: false, state: "created", extraction: { lines: 53 }, reconciliation: { status: "matched" } })
    expect(body.questions).toHaveLength(27)
    expect(seen.modelCalls).toBe(1)
    expect(await tableCounts()).toEqual({ projects: 1, boqs: 1, lines: 53 })
    expect(await (await GET(get(`?jobId=${first.jobId}`))).json()).toMatchObject({ state: "created", projectId: body.projectId })
    // And once more: the first project, nothing inserted.
    const again = await POST(post({ fields: { acknowledgeQuestions: "true" } }))
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ duplicate: true, projectId: body.projectId })
    expect(await tableCounts()).toEqual({ projects: 1, boqs: 1, lines: 53 })
  })

  test("a shortfall is 422 extraction_total_mismatch and creates nothing; acknowledgeShortfall=true creates it", async () => {
    model = async (req) => JSON.stringify({ ...JSON.parse(await deterministicModel(req)), controlTotals: { grand: 9000 } })
    const res = await POST(post({ bytes: SHORT_BOOK }))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: "extraction_total_mismatch" })
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })
    const job = await (await GET(get(`?sha256=${sha(SHORT_BOOK)}`))).json()
    expect(job).toMatchObject({ state: "rejected", error: { code: "extraction_total_mismatch" } })
    const ok = await POST(post({ bytes: SHORT_BOOK, fields: { acknowledgeShortfall: "true" } }))
    expect(ok.status).toBe(201)
    expect(await ok.json()).toMatchObject({ state: "created", reconciliation: { status: "shortfall", expected: 9000, actual: 5000 } })
    expect(await tableCounts()).toEqual({ projects: 1, boqs: 1, lines: 1 })
  })

  test("mode=prepare stops at ready: 200 and nothing created; the next POST creates it", async () => {
    model = deterministicModel
    const prepared = await POST(post({ bytes: SMALL_BOOK, fields: { mode: "prepare" } }))
    expect(prepared.status).toBe(200)
    expect(await prepared.json()).toMatchObject({ state: "ready", questions: [] })
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })
    const created = await POST(post({ bytes: SMALL_BOOK }))
    expect(created.status).toBe(201)
    expect(seen.modelCalls).toBe(1)
    expect(await tableCounts()).toEqual({ projects: 1, boqs: 1, lines: 1 })
  })
})

describe("?async=1: the answer does not wait for the extraction", () => {
  test("202 received with a job id at once; the job reads received; after the queued run it reads created", async () => {
    model = deterministicModel
    const res = await POST(post({ bytes: SMALL_BOOK, query: "?async=1" }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.state).toBe("received")
    expect(typeof body.jobId).toBe("string")
    // Nothing has run yet: no model call, no project, and the job says received.
    expect(seen.modelCalls).toBe(0)
    expect(queued).toHaveLength(1)
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })
    expect(await (await GET(get(`?jobId=${body.jobId}`))).json()).toMatchObject({ state: "received", projectId: null })
    // The same file while it is in progress is refused as in progress, not queued twice.
    const busy = await POST(post({ bytes: SMALL_BOOK, query: "?async=1" }))
    expect(busy.status).toBe(409)
    expect(await busy.json()).toMatchObject({ code: "duplicate_in_progress" })
    expect(queued).toHaveLength(1)

    await queued[0]()
    expect(seen.modelCalls).toBe(1)
    expect(await tableCounts()).toEqual({ projects: 1, boqs: 1, lines: 1 })
    expect(await (await GET(get(`?jobId=${body.jobId}`))).json()).toMatchObject({ state: "created", projectId: expect.any(String) })
    // A duplicate is answered at once and nothing is queued.
    queued = []
    const dup = await POST(post({ bytes: SMALL_BOOK, query: "?async=1" }))
    expect(dup.status).toBe(200)
    expect(await dup.json()).toMatchObject({ duplicate: true })
    expect(queued).toHaveLength(0)
  })

  test("an async job with questions ends in needs_answers, and one that is refused ends in rejected with its code", async () => {
    const waiting = await (await POST(post({ query: "?async=1" }))).json()
    await queued[0]()
    expect(await (await GET(get(`?jobId=${waiting.jobId}`))).json()).toMatchObject({ state: "needs_answers" })
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })

    queued = []
    model = async (req) => JSON.stringify({ ...JSON.parse(await deterministicModel(req)), controlTotals: { grand: 9000 } })
    const refused = await (await POST(post({ bytes: SHORT_BOOK, query: "?async=1" }))).json()
    await queued[0]()
    expect(await (await GET(get(`?jobId=${refused.jobId}`))).json()).toMatchObject({ state: "rejected", error: { code: "extraction_total_mismatch" } })
    expect(await tableCounts()).toEqual({ projects: 0, boqs: 0, lines: 0 })
  })

  test("async on a parked job answers with its state at once (a resume is queued to finish it)", async () => {
    await POST(post())
    const res = await POST(post({ fields: { acknowledgeQuestions: "true" }, query: "?async=1" }))
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ state: "needs_answers" })
    expect(queued).toHaveLength(1)
    await queued[0]()
    expect(await tableCounts()).toEqual({ projects: 1, boqs: 1, lines: 53 })
    expect(seen.modelCalls).toBe(1)
  })
})

describe("the gates", () => {
  test("an unknown mode is 400 before anything is claimed", async () => {
    const res = await POST(post({ fields: { mode: "delete" } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "invalid_mode" })
    expect((await h.pg.query("select 1 from compliance.source_object")).rows).toHaveLength(0)
  })

  test("GET wants a job reference, finds only this organisation's jobs, and refuses a project key", async () => {
    expect((await GET(get(""))).status).toBe(400)
    expect(await (await GET(get("?sha256=nothex"))).json()).toMatchObject({ code: "job_reference_required" })
    expect((await GET(get("?jobId=nope"))).status).toBe(404)
    const job = await (await POST(post())).json()
    expect((await GET(get(`?jobId=${job.jobId}`))).status).toBe(200)
    auth = { orgId: OTHER_ORG }
    expect((await GET(get(`?jobId=${job.jobId}`))).status).toBe(404)
    auth = { orgId: null }
    expect((await GET(get(`?jobId=${job.jobId}`))).status).toBe(400)
    auth = { orgId: ORG, keyKind: "project_ai" }
    const refused = await GET(get(`?jobId=${job.jobId}`))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: "project_key_not_allowed" })
  })

  test("GET asks the same role floor as POST and returns the guard's own answer when it refuses", async () => {
    auth = { orgId: ORG, roleErr: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }) }
    expect((await GET(get("?jobId=x"))).status).toBe(403)
    expect(roleGuard).toHaveBeenCalledWith(expect.anything(), "member", "read")
  })
})
