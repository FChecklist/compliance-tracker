/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-27, BR-404 [EXIT] (D-11 as amended by PMD-09 and AM-088), and the test BR-405's mutation
// boq-keyset-no-limit must break (scripts/verify/mutations.tsv).
//
// CLAIM. With BUILD001_BOQ_KEYSET_PAGINATION on, the default GET /api/v1/construction/boq?projectId= on a project
// shaped like the largest live one (dd486dad, 2026-09-25: 5,924 BOQ headers, 10,907 line items, 7,561,948 bytes of
// line-item JSON) returns the current revision's first page only, a body under 1,048,576 bytes, in under 2,000 ms.
//
// FIXTURE (built below, deterministic). 5,924 headers in the live chain shape: 4,381 single BOQs, 690 two-revision
// chains, one chain each of 3 to 14 revisions, three of 15 and one of 16 (live: 5,177 / 690 / 1 each / 3 / 1 on 6,702
// headers). Every older revision is superseded; 123 tips approved, 14 submitted, the rest draft (live: 123 / 14). The
// current revision (resolveCurrentBoq: approved, highest version) is the tip of the 16-revision chain and carries 153
// lines, the largest real BOQ; the other 10,754 lines follow the live lines-per-BOQ spread (1 to 4, two BOQs of 12).
//
// WHAT IS MEASURED. The real route handler, the real service code and real SQL on PGlite (in-process Postgres, in
// memory, see src/lib/services/__test-helpers__/boq-keyset-pglite.ts); only auth and withTenantContext are replaced.
// "Route time" is the wall time of the GET handler call (auth double, the service's four statements on PGlite, the
// cost-visibility gate, JSON serialisation): not a network round trip and not the live database. End-to-end latency
// on a deployed instance stays unverified until go-live (MASTER_PLAN, AM-088).
//
// Run: bun test --isolate src/app/api/v1/construction/boq/route.d11.test.ts
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { NextRequest } from "next/server"
import * as realAuthGuard from "@/lib/supabase/auth-guard"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { BOQ_KEYSET_PAGINATION_FLAG, decodeBoqLineCursor, encodeBoqLineCursor } from "@/lib/boq-line-keyset"
import {
  boqRow,
  createBoqPglite,
  fakeCuid,
  insertRows,
  lineRow,
  seededRandom,
} from "@/lib/services/__test-helpers__/boq-keyset-pglite"

const ORG = "0d110000-0000-4000-8000-00000000d011"
const PROJECT = "dd486dad-0000-4000-8000-0000000d11f1"
const OTHER_PROJECT = "dd486dad-0000-4000-8000-0000000d11f2"
const ONE_MIB = 1_048_576
const HEADERS = 5_924
const LINES = 10_907

type Caller = { role: string | null; apiKeyOnly: boolean }
let caller: Caller = { role: null, apiKeyOnly: true }

let h: Awaited<ReturnType<typeof createBoqPglite>>
let GET: (request: NextRequest) => Promise<Response>
let currentId = ""
const chainIds: string[] = [] // the current revision's chain, version 16 first (listBoqs order)
const currentLineIds: string[] = []
let otherProjectBoqId = ""

const byteOrder = (ids: string[]) => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

const DESCRIPTIONS = [
  "Supply and fix 12 mm gypsum board partition on GI frame, taped and jointed",
  "Excavation in ordinary soil up to 1.5 m depth including disposal within 50 m lead",
  "PCC 1:4:8 below footings with 40 mm aggregate",
  "Providing and laying vitrified floor tiles 600 x 600 mm in cement mortar 1:4",
  "Internal plastering 12 mm thick in CM 1:6 finished smooth",
  "Two coats of acrylic emulsion paint over one coat of primer",
  "False ceiling in 600 x 600 mm mineral fibre tiles on exposed grid",
  "Wiring for light points with 1.5 sq mm FR copper conductor in PVC conduit",
]
const CATEGORIES = ["Civil", "Gypsum", "Flooring", "Painting", "Electrical", "Ceiling"]

function buildFixture() {
  const random = seededRandom(10_907)
  const shuffle = <T,>(items: T[]) => {
    for (let k = items.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1))
      ;[items[k], items[j]] = [items[j], items[k]]
    }
    return items
  }

  // Chain lengths in the live shape, the 16-revision chain first so its tip is easy to name.
  const chainLengths = [16, 15, 15, 15, ...Array.from({ length: 12 }, (_, k) => 14 - k), ...Array(690).fill(2), ...Array(4_381).fill(1)]
  const headers: ReturnType<typeof boqRow>[] = []
  const tips: { id: string; single: boolean }[] = []
  let minute = 0
  const at = () => new Date(Date.UTC(2026, 6, 19) + 10 * 60_000 * minute++).toISOString()
  for (const length of chainLengths) {
    let parent: string | null = null
    for (let version = 1; version <= length; version++) {
      const id = fakeCuid(random)
      const tip = version === length
      headers.push(
        boqRow({
          id,
          org_id: ORG,
          project_id: PROJECT,
          version,
          parent_boq_id: parent,
          title: `R4 revision spec ${1_789_907_959_081 + headers.length}`,
          status: tip ? "draft" : "superseded",
          created_at: at(),
        })
      )
      if (length === 16) chainIds.unshift(id)
      if (tip) tips.push({ id, single: length === 1 })
      parent = id
    }
  }
  currentId = chainIds[0]
  const byId = new Map(headers.map((h) => [h.id, h]))
  byId.get(currentId)!.status = "approved"
  const singles = shuffle(tips.filter((t) => t.single).map((t) => t.id))
  for (const id of singles.slice(0, 122)) byId.get(id)!.status = "approved"
  for (const id of singles.slice(122, 136)) byId.get(id)!.status = "submitted"

  // Line counts: 153 on the current revision, the live spread on the other 5,923.
  const spread = [0, ...Array(3_004).fill(1), ...Array(1_316).fill(2), ...Array(1_307).fill(3), ...Array(292).fill(4), 5, 12, 12]
  const others = shuffle(headers.filter((h) => h.id !== currentId).map((h) => h.id))
  const counts = new Map<string, number>(others.map((id, k) => [id, spread[k]]))
  counts.set(currentId, 153)

  const lines: Record<string, unknown>[] = []
  for (const header of headers) {
    const count = counts.get(header.id)!
    let rootId = ""
    for (let k = 0; k < count; k++) {
      const id = fakeCuid(random)
      const isRoot = k % 3 === 0
      if (isRoot) rootId = id
      if (header.id === currentId) currentLineIds.push(id)
      const quantity = (1 + Math.floor(random() * 400)) / 4
      const rate = 100 + Math.floor(random() * 90_000) / 100
      lines.push(
        lineRow({
          id,
          boq_id: header.id,
          org_id: ORG,
          item_code: `${CATEGORIES[k % CATEGORIES.length].slice(0, 3).toUpperCase()}-${String(k + 1).padStart(3, "0")}`,
          description: DESCRIPTIONS[Math.floor(random() * DESCRIPTIONS.length)],
          unit: k % 2 ? "m2" : "cum",
          quantity: quantity.toFixed(3),
          rate: rate.toFixed(2),
          amount: (quantity * rate).toFixed(2),
          created_at: header.created_at,
          parent_line_item_id: isRoot ? null : rootId,
          breakdown_percentage: isRoot ? null : "50",
          material_amount: (quantity * rate * 0.6).toFixed(2),
          manpower_amount: (quantity * rate * 0.4).toFixed(2),
          category: CATEGORIES[k % CATEGORIES.length],
          qty_project: quantity.toFixed(3),
          rate_project: (rate * 0.82).toFixed(2),
          qty_contract: quantity.toFixed(3),
          rate_contract: rate.toFixed(2),
        })
      )
    }
  }

  // One BOQ of the same organisation on another project, for the "cursor from elsewhere" check.
  otherProjectBoqId = fakeCuid(random)
  headers.push(boqRow({ id: otherProjectBoqId, org_id: ORG, project_id: OTHER_PROJECT, version: 1, status: "approved", created_at: at() }))
  lines.push(lineRow({ id: fakeCuid(random), boq_id: otherProjectBoqId, org_id: ORG, description: "OTHER-PROJECT-LINE" }))
  return { headers, lines }
}

beforeAll(async () => {
  h = await createBoqPglite()
  const { headers, lines } = buildFixture()
  await insertRows(h.pg, "construction_boqs", headers)
  await insertRows(h.pg, "construction_boq_line_items", lines)

  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: h.withTenantContextDouble }))
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...realAuthGuard,
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: ORG,
      dbUser: caller.apiKeyOnly ? null : { id: "user-d11", role: caller.role },
      apiKey: caller.apiKeyOnly ? { id: "key-d11", name: "PROJEXA proxy key", scopes: ["read"] } : null,
    })),
  }))
  ;({ GET } = await import("./route"))
}, 120_000)

afterAll(async () => {
  await h.pg.close()
})

async function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env[BOQ_KEYSET_PAGINATION_FLAG]
  if (value === undefined) delete process.env[BOQ_KEYSET_PAGINATION_FLAG]
  else process.env[BOQ_KEYSET_PAGINATION_FLAG] = value
  try {
    return await fn()
  } finally {
    if (original === undefined) delete process.env[BOQ_KEYSET_PAGINATION_FLAG]
    else process.env[BOQ_KEYSET_PAGINATION_FLAG] = original
  }
}

async function get(query: string) {
  const started = performance.now()
  const res = await GET(new NextRequest(`http://localhost/api/v1/construction/boq?${query}`))
  const ms = performance.now() - started
  const body = await res.json()
  return { status: res.status, body, ms, bytes: Buffer.byteLength(JSON.stringify(body)) }
}

type PagedBody = {
  boqs: Array<Record<string, unknown> & { id: string; version: number; lineItems?: Array<{ id: string; boqId: string }> }>
  revision: string | null
  limit: number
  nextCursor: string | null
  hasMore: boolean
}

describe("the fixture has the shape of the largest live project", () => {
  test("5,924 headers and 10,907 line items on the project, about 7.56 MB of line-item row JSON", async () => {
    const r = await h.pg.query<{ headers: number; lines: number; line_bytes: number; max_lines: number; approved: number; submitted: number; superseded: number }>(
      `select (select count(*)::int from compliance.construction_boqs where project_id = $1) headers,
              (select count(*)::int from compliance.construction_boq_line_items li join compliance.construction_boqs b on b.id = li.boq_id where b.project_id = $1) lines,
              (select sum(length(row_to_json(li)::text))::int from compliance.construction_boq_line_items li join compliance.construction_boqs b on b.id = li.boq_id where b.project_id = $1) line_bytes,
              (select max(n)::int from (select count(*) n from compliance.construction_boq_line_items li join compliance.construction_boqs b on b.id = li.boq_id where b.project_id = $1 group by li.boq_id) x) max_lines,
              (select count(*)::int from compliance.construction_boqs where project_id = $1 and status = 'approved') approved,
              (select count(*)::int from compliance.construction_boqs where project_id = $1 and status = 'submitted') submitted,
              (select count(*)::int from compliance.construction_boqs where project_id = $1 and status = 'superseded') superseded`,
      [PROJECT]
    )
    const shape = r.rows[0]
    console.log(`[d11 fixture] ${JSON.stringify(shape)}`)
    expect(shape.headers).toBe(HEADERS)
    expect(shape.lines).toBe(LINES)
    expect(shape.max_lines).toBe(153)
    expect(shape.approved).toBe(123)
    expect(shape.submitted).toBe(14)
    expect(shape.superseded).toBe(HEADERS - (4_381 + 690 + 16))
    // Within 10 percent of the live figure (7,561,948 bytes, sum of row_to_json over the same 10,907 rows).
    expect(shape.line_bytes).toBeGreaterThan(7_561_948 * 0.9)
    expect(shape.line_bytes).toBeLessThan(7_561_948 * 1.1)
  })
})

describe("BR-404: the default list with the flag on is the current revision's first page only", () => {
  test("body under 1,048,576 bytes, handler under 2,000 ms, 50 lines of the current revision and nothing else", async () => {
    caller = { role: null, apiKeyOnly: true }
    const logStart = h.queryLog.length
    const callsBefore = h.stats.calls
    const { status, body, ms, bytes } = await withFlag("1", () => get(`projectId=${PROJECT}`))
    console.log(`[d11 flag on] status=${status} bytes=${bytes} handler_ms=${ms.toFixed(1)} headers=${(body as PagedBody).boqs?.length}`)

    expect(status).toBe(200)
    expect(bytes).toBeLessThan(ONE_MIB)
    expect(ms).toBeLessThan(2_000)

    const page = body as PagedBody
    expect(page.revision).toBe(currentId)
    expect(page.limit).toBe(50)
    expect(page.hasMore).toBe(true)
    expect(decodeBoqLineCursor(page.nextCursor!)).toEqual({ boqId: currentId, id: byteOrder(currentLineIds)[49] })

    // Headers: the current revision's chain, version 16 down to 1, all of them, and no other BOQ of the project.
    expect(page.boqs.map((b) => b.id)).toEqual(chainIds)
    expect(page.boqs.map((b) => b.version)).toEqual(Array.from({ length: 16 }, (_, k) => 16 - k))
    const withLines = page.boqs.filter((b) => "lineItems" in b)
    expect(withLines.map((b) => b.id)).toEqual([currentId])
    expect(withLines[0].lineItems!.map((l) => l.id)).toEqual(byteOrder(currentLineIds).slice(0, 50))
    expect(withLines[0].lineItems!.every((l) => l.boqId === currentId)).toBe(true)

    // The database was asked for one page (limit + 1 rows), not for the revision or the project.
    const keyset = h.queryLog.slice(logStart).filter((q) => q.sql.includes('COLLATE "C"'))
    expect(keyset.map((q) => q.rows)).toEqual([51])
    // All data loading in one transaction (an API-key caller has no role, so the cost gate reads nothing).
    expect(h.stats.calls - callsBefore).toBe(1)
    expect(h.stats.maxDepth).toBe(1)
  })

  test("following nextCursor through the route gives 50, 50, 50 and 3 lines, 153 distinct, then nextCursor null", async () => {
    caller = { role: null, apiKeyOnly: true }
    const sizes: number[] = []
    const seen: string[] = []
    let cursor: string | null = null
    await withFlag("1", async () => {
      for (let guard = 0; guard < 10; guard++) {
        const query: string = `projectId=${PROJECT}${cursor ? `&cursor=${cursor}` : ""}`
        const { status, body, bytes } = await get(query)
        expect(status).toBe(200)
        expect(bytes).toBeLessThan(ONE_MIB)
        const page = body as PagedBody
        const lines = page.boqs.find((b) => b.id === currentId)!.lineItems!
        sizes.push(lines.length)
        seen.push(...lines.map((l) => l.id))
        cursor = page.nextCursor
        if (!cursor) {
          expect(page.hasMore).toBe(false)
          break
        }
      }
    })
    expect(sizes).toEqual([50, 50, 50, 3])
    expect(new Set(seen).size).toBe(153)
    expect(seen).toEqual(byteOrder(currentLineIds))
    expect(cursor).toBeNull()
  })

  test("the cost-visibility gate still wraps the paged response: client_viewer sees no project-side figure", async () => {
    caller = { role: "client_viewer", apiKeyOnly: false }
    const { status, body } = await withFlag("1", () => get(`projectId=${PROJECT}`))
    caller = { role: null, apiKeyOnly: true }
    expect(status).toBe(200)
    const text = JSON.stringify(body)
    for (const field of ["rateProject", "qtyProject", "projectValue", "variance", "coverageRatio"]) expect(text).not.toContain(`"${field}"`)
    const line = (body as PagedBody).boqs.find((b) => b.id === currentId)!.lineItems![0] as unknown as Record<string, unknown>
    expect(line.rateContract).toBeDefined()
    expect(line.qtyContract).toBeDefined()
  })

  test("a bad cursor or limit is 400 and a cursor from another project's BOQ is 400; nothing is read wider", async () => {
    caller = { role: null, apiKeyOnly: true }
    await withFlag("1", async () => {
      const cases = [
        `cursor=garbage`,
        `cursor=${encodeBoqLineCursor({ boqId: currentId, id: "x" })}=`,
        `limit=0`,
        `limit=201`,
        `limit=ten`,
        `cursor=${encodeBoqLineCursor({ boqId: otherProjectBoqId, id: "a" })}`,
      ]
      for (const extra of cases) {
        const logStart = h.queryLog.length
        const { status, body } = await get(`projectId=${PROJECT}&${extra}`)
        expect({ extra, status }).toEqual({ extra, status: 400 })
        expect(typeof (body as { error: string }).error).toBe("string")
        expect(h.queryLog.slice(logStart).some((q) => q.sql.includes("construction_boq_line_items"))).toBe(false)
      }
      expect((await get(`projectId=${PROJECT}&revision=no-such-boq`)).status).toBe(404)
    })
  })
})

describe("with the flag off the route is unchanged, and the fixture reproduces D-11", () => {
  test("every header with every line item: 5,924 headers, 10,907 lines, a body over 1,048,576 bytes", async () => {
    caller = { role: null, apiKeyOnly: true }
    const { status, body, bytes, ms } = await withFlag(undefined, () => get(`projectId=${PROJECT}`))
    const boqs = (body as { boqs: Array<{ lineItems: unknown[] }> }).boqs
    const lineCount = boqs.reduce((sum, b) => sum + b.lineItems.length, 0)
    console.log(`[d11 flag off] status=${status} bytes=${bytes} handler_ms=${ms.toFixed(1)} headers=${boqs.length} lines=${lineCount}`)
    expect(status).toBe(200)
    expect(Object.keys(body as object)).toEqual(["boqs"])
    expect(boqs.length).toBe(HEADERS)
    expect(lineCount).toBe(LINES)
    expect(bytes).toBeGreaterThan(ONE_MIB)
  }, 60_000)
})
