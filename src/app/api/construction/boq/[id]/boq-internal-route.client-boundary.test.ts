/// <reference types="bun-types" />
// R85 Addendum 3 v4 Phase 2 wiring pass, gate 6-03a follow-up: found this
// INTERNAL (compliance-tracker-only, requireAuth not requireAuthOrApiKey)
// route missing applyCostVisibility() entirely while wiring Phase 2's dual
// view figures in -- getBoq() already returned raw qtyProject/rateProject
// columns before Phase 2 too, so this gap pre-dates this pass; Phase 6's own
// PR (#1701) only touched the v1 (PROJEXA-facing) routes. client_viewer is a
// PROJEXA-only role and can never reach this internal route, so the
// real-world exposure was to compliance-tracker's own internal staff, not a
// customer -- still closed here rather than left as a known gap, matching
// the "every route that serves BOQ line items applies the same one gate"
// posture boq-route.client-boundary.test.ts already established for the v1
// routes. This file follows that exact test's own pattern.
import { describe, test, expect, mock, beforeEach } from "bun:test"

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
  // Phase 2's own computed dual-view fields -- exactly what a real getBoq()
  // now returns after this pass's wiring (this test mocks the service layer,
  // same as boq-route.client-boundary.test.ts, so these are supplied as
  // fixture data rather than actually computed here).
  projectValue: 4000,
  contractValue: 5000,
  variance: 1000,
  variancePercent: 20,
  quantityVariance: 0,
  rateVariance: 1000,
}

function mockAuth(opts: { role?: string } = {}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({
      response: null,
      user: { id: "auth-1" },
      orgId: ORG_ID,
      dbUser: { id: "user-1", role: opts.role ?? "member" },
    })),
  }))
}

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
    getBoq: mock(async () => ({
      id: "boq-1", title: "Villa Phase 1", version: 1,
      lineItems: [{ ...RAW_LINE_ITEM }],
      moneyView: { projectValue: 4000, contractValue: 5000, variance: 1000, variancePercent: 20, rootLineCount: 1 },
      costCoverage: { coveredContractValue: 5000, totalContractValue: 5000, coverageRatio: 100 },
    })),
    ServiceError: FakeServiceError,
  }))
}

beforeEach(() => {
  mockBoqService()
})

function bodyNeverContains(bodyText: string) {
  for (const forbidden of ["rateProject", "qtyProject", "projectValue", "variance", "quantityVariance", "rateVariance", "coverageRatio", "coveredContractValue"]) {
    expect(bodyText).not.toContain(forbidden)
  }
}

describe("GET /api/construction/boq/[id] (internal) -- cost-visibility gate now applied", () => {
  test("a role with no configured grant (fail-closed default) never sees project-side or dual-view figures", async () => {
    mockAuth({ role: "member" })
    mockCostVisibilityConfig(null)
    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost/api/construction/boq/boq-1"), { params: Promise.resolve({ id: "boq-1" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    bodyNeverContains(JSON.stringify(body))
    // Contract-side and identity fields survive redaction.
    expect(body.lineItems[0].qtyContract).toBe("100")
    expect(body.lineItems[0].rateContract).toBe("50")
    expect(body.lineItems[0].description).toBe("Excavation")
  })

  test("a role explicitly granted cost visibility DOES see the dual-view figures -- real gating, not blanket redaction", async () => {
    mockAuth({ role: "admin" })
    mockCostVisibilityConfig({ role: "admin", canSeeCost: true })
    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost/api/construction/boq/boq-1"), { params: Promise.resolve({ id: "boq-1" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.lineItems[0].rateProject).toBe("40")
    expect(body.lineItems[0].projectValue).toBe(4000)
    expect(body.moneyView.projectValue).toBe(4000)
  })
})
