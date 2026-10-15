/// <reference types="bun-types" />
// PROJEXA G-12 (audit 111, 2026-10-06): GET /api/scope?projectId= for the large Meridian Heights project exceeded
// PROJEXA's 8 s upstream budget (503). Measured root cause (live read-only, 2026-10-06): the project has 14,013 BOQ
// headers and 25,328 line items (mostly E2E residue); the line-item SELECT itself runs in ~0.2 s, there is already an
// index on boq_id, so the cost is building and shipping every line of every BOQ (~12 MB of line-item JSON, each BOQ
// also getting moneyView/costCoverage/chain variation). The list screens never read those lines.
//
// FIX UNDER TEST: `include=headers` (a closed token, like variation/compare) makes the v1 list return headers plus the
// SQL variation/compare figures and NO line item. Callers that do not send it get the identical response as before.
//
// FIXTURE: 2,500 BOQs on one project (a 40-revision chain, the rest independent) holding 2,500+ lines, real SQL on
// PGlite, the real route handler and service; only auth and withTenantContext are doubled.
// Run: bun test --isolate src/app/api/v1/construction/boq/route.headers.test.ts
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { NextRequest } from "next/server"
import * as realAuthGuard from "@/lib/supabase/auth-guard"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { BOQ_KEYSET_PAGINATION_FLAG } from "@/lib/boq-line-keyset"
import { boqRow, createBoqPglite, fakeCuid, insertRows, lineRow, seededRandom } from "@/lib/services/__test-helpers__/boq-keyset-pglite"

const ORG = "0d120000-0000-4000-8000-00000000a120"
const PROJECT = "dd486dad-0000-4000-8000-00000000a121"
const BOQS = 2_500
const CHAIN = 40

let h: Awaited<ReturnType<typeof createBoqPglite>>
let GET: (request: NextRequest) => Promise<Response>
let totalLines = 0
const chain: string[] = []

beforeAll(async () => {
  h = await createBoqPglite()
  const random = seededRandom(2_467)
  const headers: ReturnType<typeof boqRow>[] = []
  const lines: Record<string, unknown>[] = []
  let parent: string | null = null
  for (let k = 0; k < BOQS; k++) {
    const id = fakeCuid(random)
    const inChain = k < CHAIN
    headers.push(
      boqRow({
        id,
        org_id: ORG,
        project_id: PROJECT,
        version: inChain ? k + 1 : 1,
        parent_boq_id: inChain ? parent : null,
        status: inChain && k < CHAIN - 1 ? "superseded" : "draft",
        created_at: new Date(Date.UTC(2026, 6, 1) + k * 60_000).toISOString(),
      })
    )
    if (inChain) {
      chain.push(id)
      parent = id
    }
    // chain revisions grow by 5 lines each (variation is a real number); everything else holds 1 line
    const count = inChain ? 5 * (k + 1) : 1
    for (let n = 0; n < count; n++) {
      lines.push(
        lineRow({ id: fakeCuid(random), boq_id: id, org_id: ORG, item_code: `X-${k}-${n}`, quantity: "2", rate: "100", amount: "200", qty_project: "2", rate_project: "80" })
      )
    }
  }
  totalLines = lines.length
  await insertRows(h.pg, "construction_boqs", headers)
  await insertRows(h.pg, "construction_boq_line_items", lines)
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: h.withTenantContextDouble }))
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...realAuthGuard,
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: ORG,
      dbUser: null,
      apiKey: { id: "key-g12", name: "PROJEXA proxy key", scopes: ["read"] },
    })),
  }))
  ;({ GET } = await import("./route"))
}, 120_000)

afterAll(async () => {
  await h.pg.close()
})

async function get(query: string) {
  h.queryLog.length = 0
  const started = performance.now()
  const res = await GET(new NextRequest(`http://localhost/api/v1/construction/boq?projectId=${PROJECT}${query}`))
  const body = await res.json()
  const ms = performance.now() - started
  const statements = h.queryLog.map((q) => q.sql)
  return { status: res.status, body, ms, bytes: Buffer.byteLength(JSON.stringify(body)), statements, log: [...h.queryLog] }
}

type Row = Record<string, unknown> & { id: string; lineItems?: unknown[] }

describe("G-12: include=headers on a 2,500-BOQ project", () => {
  test("fixture shape", () => {
    expect(totalLines).toBeGreaterThan(2_500)
  })

  test("default (no token): every line of every BOQ, exactly the old contract", async () => {
    const r = await get("")
    expect(r.status).toBe(200)
    const boqs = r.body.boqs as Row[]
    expect(boqs).toHaveLength(BOQS)
    expect(boqs.reduce((n, b) => n + (b.lineItems?.length ?? 0), 0)).toBe(totalLines)
    console.log(`[G-12] default: ${r.bytes} bytes, ${r.statements.length} statements, ${r.ms.toFixed(0)} ms`)
  })

  test("include=headers: no line item anywhere, no statement reads line items, payload a fraction of the default", async () => {
    const full = await get("")
    const lean = await get("&include=headers")
    expect(lean.status).toBe(200)
    const boqs = lean.body.boqs as Row[]
    expect(boqs).toHaveLength(BOQS)
    expect(boqs.some((b) => "lineItems" in b)).toBe(false)
    expect(lean.statements.some((s) => /construction_boq_line_items/.test(s))).toBe(false)
    expect(lean.statements.length).toBeLessThanOrEqual(2)
    expect(lean.bytes).toBeLessThan(full.bytes * 0.5)
    console.log(`[G-12] headers: ${lean.bytes} bytes (${((lean.bytes / full.bytes) * 100).toFixed(0)}% of ${full.bytes}), ${lean.statements.length} statements, ${lean.ms.toFixed(0)} ms vs ${full.ms.toFixed(0)} ms`)
  })

  test("include=headers,variation,compare: SQL figures still correct, still no line items, one aggregate statement", async () => {
    const lean = await get("&include=headers,variation,compare")
    const boqs = lean.body.boqs as Array<Row & { variationVsPrior?: number | null; lineDelta?: number | null; compare?: { lineCount: number; total: number } }>
    expect(boqs.some((b) => "lineItems" in b)).toBe(false)
    const second = boqs.find((b) => b.id === chain[1])!
    // revision 2 has 10 lines against revision 1's 5, each 2 x 100 = 200: +5 lines, +1,000
    expect(second.lineDelta).toBe(5)
    expect(second.variationVsPrior).toBe(1_000)
    expect(second.compare!.lineCount).toBe(10)
    expect(lean.statements.length).toBeLessThanOrEqual(3)
  })

  test("the existing ScopeClient request (include=variation) is unchanged: it still carries lines", async () => {
    const r = await get("&include=variation")
    const boqs = r.body.boqs as Row[]
    expect(boqs.reduce((n, b) => n + (b.lineItems?.length ?? 0), 0)).toBe(totalLines)
  })

  test("with the keyset flag on, headers does not change the paged-line behaviour", async () => {
    const original = process.env[BOQ_KEYSET_PAGINATION_FLAG]
    process.env[BOQ_KEYSET_PAGINATION_FLAG] = "1"
    try {
      const r = await get("&include=headers")
      expect(r.status).toBe(200)
      expect(r.body.limit).toBe(50)
    } finally {
      if (original === undefined) delete process.env[BOQ_KEYSET_PAGINATION_FLAG]
      else process.env[BOQ_KEYSET_PAGINATION_FLAG] = original
    }
  })
})
