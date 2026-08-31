/// <reference types="bun-types" />
// Regression test for API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27):
// this GET previously had no role floor at all -- any authenticated rank-1
// role (viewer/client_viewer/external_auditor/stage_0, see ROLE_RANK in
// auth-guard.ts) could read every overdue invoice's real AR balance
// (outstandingAmount/totalOutstanding/bucket totals) plus the customer's
// name -- a financial/collections report, not pure reference data.
//
// Only requireAuthOrApiKey is mocked (to hand back a dbUser carrying a
// chosen role); requireRoleOrScope/requireRole/ROLE_RANK are the REAL
// primitives from auth-guard.ts, not reimplemented or mocked -- same
// posture as permission-service.test.ts's own header comment on why rank
// comparisons must be exercised for real, not faked. This fails red if the
// requireRoleOrScope(ctx, "member", "read") call in route.ts is reverted:
// every "blocked" test below would start seeing 200s instead of 403s.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"
import type { UserRole } from "@/lib/supabase/auth-guard"

// The very first real (unmocked) `import("@/lib/supabase/auth-guard")` /
// `import("@/lib/services/erp-invoicing-service")` in this file pays a
// one-time cold transform cost for their full transitive dependency graph
// (many files) -- observed 15-18s locally, well past bun:test's 5000ms
// default. Every later import of the same specifier in this file reuses the
// already-transformed module and is fast. Bumping the file's default
// timeout (not skipping/weakening any assertion) is the fix, not a raised
// bar the tests need to clear.
setDefaultTimeout(30000)

async function mockAuth(role: UserRole | null, orgId: string | null = "org-1") {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({
      orgId,
      dbUser: role ? ({ role, id: "user-1" } as any) : null,
      apiKey: null,
      response: null,
    })),
  }))
}

async function mockDunningList(report: unknown) {
  const dunningList = mock(async () => report)
  const actual = await import("@/lib/services/erp-invoicing-service")
  mock.module("@/lib/services/erp-invoicing-service", () => ({ ...actual, dunningList }))
  return dunningList
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/dunning-list${query}`)
}

const REPORT = {
  asOfDate: "2026-08-27",
  buckets: { d1_30: 1000, d31_60: 0, d61_90: 0, d90Plus: 0 },
  counts: { d1_30: 1, d31_60: 0, d61_90: 0, d90Plus: 0 },
  totalOutstanding: 1000,
  invoices: [],
}

describe("GET /api/v1/projexa/dunning-list", () => {
  test("a rank-1 role (external_auditor) is blocked with 403, dunningList is never called", async () => {
    await mockAuth("external_auditor")
    const dunningList = await mockDunningList(REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(dunningList).not.toHaveBeenCalled()
  })

  test("a rank-1 role (client_viewer) is blocked with 403, dunningList is never called", async () => {
    await mockAuth("client_viewer")
    const dunningList = await mockDunningList(REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(dunningList).not.toHaveBeenCalled()
  })

  test("member (the chosen floor) can read the dunning list", async () => {
    await mockAuth("member")
    const dunningList = await mockDunningList(REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(dunningList).toHaveBeenCalledWith({ orgId: "org-1" }, undefined)
    expect(await res.json()).toEqual(REPORT)
  })

  test("a role above the floor (manager) can also read the dunning list", async () => {
    await mockAuth("manager")
    const dunningList = await mockDunningList(REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(dunningList).toHaveBeenCalled()
  })

  test("an invalid/missing session or API key never reaches dunningList", async () => {
    const actual = await import("@/lib/supabase/auth-guard")
    mock.module("@/lib/supabase/auth-guard", () => ({
      ...actual,
      requireAuthOrApiKey: mock(async () => ({
        orgId: null,
        dbUser: null,
        apiKey: null,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      })),
    }))
    const dunningList = await mockDunningList(REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(dunningList).not.toHaveBeenCalled()
  })
})
