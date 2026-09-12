/// <reference types="bun-types" />
// R85 Addendum 3 v4 Phase 6 -- VISIBILITY AND THE CLIENT BOUNDARY, gate
// 6-03a. Real-route-handler proof (not a unit test of the helper alone --
// see cost-visibility-service.test.ts for that) that GET
// /api/v1/construction/boq, GET /api/v1/construction/boq/[id] and GET
// /api/v1/construction/boq/[id]/compare (which also serve
// /api/v1/projexa/scope, /api/v1/projexa/scope/[id] and
// /api/v1/projexa/scope/[id]/compare via a pure re-export, see those files'
// own header comments) never return rate_project/qty_project/project_value/
// variance-family fields to a client_viewer, and DO return them to a role
// the org has explicitly granted cost visibility to (proving this is real
// gating, not a route that always strips everything).
//
// 6-03d (the falsifiability proof this phase cares about most) was
// performed by hand against this exact file: applyCostVisibility()'s call
// in src/app/api/v1/construction/boq/route.ts was temporarily removed (the
// route returned `NextResponse.json({ boqs })` unredacted, exactly as it did
// before this phase), this suite was re-run and the "client_viewer never
// sees rateProject" test below went RED, then the removal was reverted and
// the suite went GREEN again. The verbatim RED output is recorded in this
// phase's PR description, not restated here as prose that could drift from
// what was actually observed.
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { NextRequest } from "next/server"

const ORG_ID = "org-1"

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const RAW_LINE_ITEM = {
  id: "line-1",
  boqId: "boq-1",
  parentLineItemId: null as string | null,
  qtyProject: "100",
  rateProject: "40",
  qtyContract: "100",
  rateContract: "50",
  description: "Excavation",
}

function mockAuth(opts: { role?: string; apiKeyOnly?: boolean } = {}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: ORG_ID,
      dbUser: opts.apiKeyOnly ? null : { id: "user-1", role: opts.role ?? "member" },
      apiKey: opts.apiKeyOnly ? { id: "key-1", name: "test key", scopes: ["read", "write"] } : null,
    })),
    requireRoleOrScope: mock(() => null),
  }))
}

/** Mocks the cost_visibility_config table read canRoleSeeCostWithDb performs. */
function mockCostVisibilityConfig(row: { role: string; canSeeCost: boolean } | null) {
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      fn({
        query: {
          costVisibilityConfig: {
            findFirst: mock(async () => (row ? { ...row, changedById: "u1", changedAt: new Date() } : null)),
          },
        },
      })
    ),
  }))
}

function mockBoqService() {
  mock.module("@/lib/services/construction-boq-service", () => ({
    listBoqs: mock(async () => [{ id: "boq-1", title: "Villa Phase 1", version: 1, lineItems: [{ ...RAW_LINE_ITEM }] }]),
    getBoq: mock(async () => ({ id: "boq-1", title: "Villa Phase 1", version: 1, lineItems: [{ ...RAW_LINE_ITEM }] })),
    compareBoq: mock(async () => ({
      added: [{ ...RAW_LINE_ITEM, id: "line-2" }],
      removed: [] as unknown[],
      changed: [] as unknown[],
    })),
    parseBoqInclude: () => ({ variation: false, compare: false }),
    createBoq: mock(async () => ({})),
    updateBoq: mock(async () => ({})),
    deleteBoq: mock(async () => ({})),
    ServiceError: FakeServiceError,
  }))
}

beforeEach(() => {
  mockBoqService()
})

function bodyNeverContains(bodyText: string) {
  for (const forbidden of ["rateProject", "qtyProject", "projectValue", "variance", "quantityVariance", "rateVariance", "coverageRatio"]) {
    expect(bodyText).not.toContain(forbidden)
  }
}

describe("GET /api/v1/construction/boq -- 6-03a client boundary", () => {
  test("client_viewer NEVER sees rate_project/qty_project/variance-family fields, but keeps the contract-side figures", async () => {
    mockAuth({ role: "client_viewer" })
    mockCostVisibilityConfig(null) // irrelevant -- client_viewer short-circuits before any config read
    const { GET } = await import("./route")
    const res = await GET(new NextRequest("http://localhost/api/v1/construction/boq?projectId=proj-1"))
    const body = await res.json()
    const bodyText = JSON.stringify(body)

    expect(res.status).toBe(200)
    bodyNeverContains(bodyText)
    expect(body.boqs[0].lineItems[0].qtyContract).toBe("100")
    expect(body.boqs[0].lineItems[0].rateContract).toBe("50")
    expect(body.boqs[0].lineItems[0].description).toBe("Excavation")
  })

  test("a role explicitly granted cost visibility (admin, canSeeCost: true) DOES see rate_project -- this is real gating, not blanket redaction", async () => {
    mockAuth({ role: "admin" })
    mockCostVisibilityConfig({ role: "admin", canSeeCost: true })
    const { GET } = await import("./route")
    const res = await GET(new NextRequest("http://localhost/api/v1/construction/boq?projectId=proj-1"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.boqs[0].lineItems[0].rateProject).toBe("40")
    expect(body.boqs[0].lineItems[0].qtyProject).toBe("100")
  })

  test("admin with NO configured grant defaults to redacted (fail-closed -- a role is never cost-visible just by being admin)", async () => {
    mockAuth({ role: "admin" })
    mockCostVisibilityConfig(null)
    const { GET } = await import("./route")
    const res = await GET(new NextRequest("http://localhost/api/v1/construction/boq?projectId=proj-1"))
    const body = await res.json()
    bodyNeverContains(JSON.stringify(body))
  })

  test("a bare API-key caller (no session, no resolvable internal role) is always redacted regardless of scopes", async () => {
    mockAuth({ apiKeyOnly: true })
    mockCostVisibilityConfig({ role: "admin", canSeeCost: true }) // even if SOME role is granted org-wide
    const { GET } = await import("./route")
    const res = await GET(new NextRequest("http://localhost/api/v1/construction/boq?projectId=proj-1"))
    const body = await res.json()
    bodyNeverContains(JSON.stringify(body))
  })
})

describe("GET /api/v1/construction/boq/[id] -- 6-03a client boundary", () => {
  test("client_viewer never sees rate_project/qty_project on a single BOQ fetch", async () => {
    mockAuth({ role: "client_viewer" })
    mockCostVisibilityConfig(null)
    const { GET } = await import("./[id]/route")
    const res = await GET(new NextRequest("http://localhost/api/v1/construction/boq/boq-1"), { params: Promise.resolve({ id: "boq-1" }) })
    const body = await res.json()
    bodyNeverContains(JSON.stringify(body))
    expect(body.lineItems[0].qtyContract).toBe("100")
  })
})

describe("GET /api/v1/construction/boq/[id]/compare -- 6-03a client boundary", () => {
  test("client_viewer never sees rate_project/qty_project in the added/removed/changed diff", async () => {
    mockAuth({ role: "client_viewer" })
    mockCostVisibilityConfig(null)
    const { GET } = await import("./[id]/compare/route")
    const res = await GET(new NextRequest("http://localhost/api/v1/construction/boq/boq-1/compare"), { params: Promise.resolve({ id: "boq-1" }) })
    const body = await res.json()
    bodyNeverContains(JSON.stringify(body))
    expect(body.added[0].qtyContract).toBe("100")
  })
})
