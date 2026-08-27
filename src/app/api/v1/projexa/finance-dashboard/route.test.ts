/// <reference types="bun-types" />
// R58 Lane 2 (API_READ_WITHOUT_ROLE_CHECK fix): the first test coverage for
// GET /api/v1/projexa/finance-dashboard. Before this fix, the route called
// only requireAuthOrApiKey() -- no requireRoleOrScope() gate at all -- so
// any authenticated rank-1 role (viewer/client_viewer/external_auditor/
// stage_0) could read the org's real cash position, AR aging, named
// customers' overdue invoice amounts, and revenue trend.
//
// Deliberately mocks ONLY requireAuthOrApiKey (spreading the module's other
// real exports via `...actual`), NOT requireRoleOrScope itself -- so this
// test exercises the REAL requireRoleOrScope/hasRole/ROLE_RANK logic from
// auth-guard.ts against a real dbUser.role value, the same way
// auth-guard.test.ts builds a CombinedAuthContext object literal directly.
// A mock that stubbed requireRoleOrScope's return value instead (as
// module-chain/route.test.ts does) would keep passing even if the route's
// own requireRoleOrScope(...) call were deleted, as long as the mock still
// returned null -- it would not actually catch a regression. This test
// does: reverting the fix (deleting the requireRoleOrScope call in
// route.ts) makes the rank-1 test below fail (200 instead of 403).
//
// getFinanceDashboard itself is mocked, matching this repo's established
// precedent (see tasks/[id]/status/route.test.ts's own header) of never
// touching withTenantContext/a live DB from a .test.ts file -- this proves
// the route's own authz wiring, not erp-invoicing-service.ts's query logic.
import { describe, test as bunTest, expect, mock } from "bun:test"

// This environment's filesystem is slow enough that first-time
// transpilation of the real auth-guard.ts import graph (drizzle client,
// invite/org-provisioning services, etc.) has been observed taking anywhere
// from ~500ms to ~90s cold, well past bun:test's 5000ms default per-test
// timeout -- that's an environment characteristic, not a hang in the route
// itself (confirmed: once warm, GET resolves in <100ms). A generous 30s
// per-test timeout absorbs that without masking a real regression, since an
// actual bug here (wrong status code) fails immediately, it doesn't hang.
const test = (name: string, fn: () => Promise<void>) => bunTest(name, fn, 30000)

const FAKE_DASHBOARD = {
  asOfDate: "2026-08-27",
  cashPosition: 125000,
  arAging: { totalOutstanding: 42000, buckets: { current: 20000, d1_30: 12000, d31_60: 6000, d61_90: 3000, d90Plus: 1000 } },
  topOverdueInvoices: [{ invoiceId: "inv-1", customerName: "Acme Co", outstandingAmount: "5000", daysOverdue: 45 }],
  revenue: { thisMonth: 80000, lastMonth: 72000 },
}

async function mockAuth(dbUser: { role: string } | null, apiKey: { id: string; name: string; scopes: string[] } | null = null) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({
      orgId: dbUser || apiKey ? "org-1" : null,
      dbUser: dbUser as any,
      apiKey,
      response: null,
    })),
  }))
}

async function mockService() {
  const getFinanceDashboard = mock(async () => FAKE_DASHBOARD)
  const actual = await import("@/lib/services/erp-invoicing-service")
  mock.module("@/lib/services/erp-invoicing-service", () => ({ ...actual, getFinanceDashboard }))
  return getFinanceDashboard
}

function getRequest() {
  return new Request("http://localhost/api/v1/projexa/finance-dashboard", { method: "GET" })
}

describe("GET /api/v1/projexa/finance-dashboard (R58 Lane 2 role-check fix)", () => {
  test("a rank-1 role (external_auditor) is rejected with 403, getFinanceDashboard never called", async () => {
    await mockAuth({ role: "external_auditor" })
    const getFinanceDashboard = await mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })

  test("a rank-1 role (client_viewer) is rejected with 403, getFinanceDashboard never called", async () => {
    await mockAuth({ role: "client_viewer" })
    const getFinanceDashboard = await mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })

  test("the chosen floor role (member) succeeds and returns the dashboard", async () => {
    await mockAuth({ role: "member" })
    const getFinanceDashboard = await mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getFinanceDashboard).toHaveBeenCalledWith({ orgId: "org-1" })
    expect(await res.json()).toEqual(FAKE_DASHBOARD)
  })

  test("a role above the floor (manager) also succeeds", async () => {
    await mockAuth({ role: "manager" })
    const getFinanceDashboard = await mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getFinanceDashboard).toHaveBeenCalledWith({ orgId: "org-1" })
  })

  test("an API key without read scope is rejected with 403, getFinanceDashboard never called", async () => {
    await mockAuth(null, { id: "key-1", name: "Test Key", scopes: ["write"] })
    const getFinanceDashboard = await mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })

  test("an API key with read scope succeeds", async () => {
    await mockAuth(null, { id: "key-1", name: "Test Key", scopes: ["read"] })
    const getFinanceDashboard = await mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getFinanceDashboard).toHaveBeenCalledWith({ orgId: "org-1" })
  })

  test("an unauthenticated caller never reaches getFinanceDashboard", async () => {
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
    const getFinanceDashboard = await mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })
})
