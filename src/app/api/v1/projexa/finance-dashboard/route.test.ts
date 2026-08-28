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

// R60/E-138: single mock.module() registration per mocked module, mutated
// per-test via a plain variable, instead of calling mock.module() fresh
// inside every test (the prior shape). Matches the pattern already proven
// reliable in balance-sheet/route.test.ts after the same investigation:
// bun's mock.module() factory can lose a race against a DIFFERENT test
// file's own mock.module() call for the same specifier when many files run
// in one process (confirmed reproducing this file's exact 2-test failure
// locally, 4/4 runs, fixed by this reorder with 4/4 clean runs after).
// Re-registering the mock repeatedly (once per test) widens the window for
// that race; registering once and mutating a captured variable does not.
let currentAuthCtx: { orgId: string | null; dbUser: unknown; apiKey: unknown; response: Response | null }
let getFinanceDashboardMock = mock(async () => FAKE_DASHBOARD)

// Import the real modules ONCE, before registering the mocks -- capturing
// `actual` in a closure here (not re-importing the same specifier INSIDE
// the mock.module factory, which self-referentially re-triggers the mock
// being registered and hangs bun's module resolver).
const actualAuthGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...actualAuthGuard,
  requireAuthOrApiKey: mock(async () => currentAuthCtx),
}))

const actualInvoicingService = await import("@/lib/services/erp-invoicing-service")
mock.module("@/lib/services/erp-invoicing-service", () => ({
  ...actualInvoicingService,
  getFinanceDashboard: mock((...args: unknown[]) => getFinanceDashboardMock(...(args as []))),
}))

function mockAuth(
  dbUser: { role: string } | null,
  apiKey: { id: string; name: string; scopes: string[] } | null = null,
  response: Response | null = null,
) {
  currentAuthCtx = {
    orgId: response ? null : dbUser || apiKey ? "org-1" : null,
    dbUser: dbUser as any,
    apiKey,
    response,
  }
}

function mockService() {
  getFinanceDashboardMock = mock(async () => FAKE_DASHBOARD)
  return getFinanceDashboardMock
}

function getRequest() {
  return new Request("http://localhost/api/v1/projexa/finance-dashboard", { method: "GET" })
}

describe("GET /api/v1/projexa/finance-dashboard (R58 Lane 2 role-check fix)", () => {
  test("a rank-1 role (external_auditor) is rejected with 403, getFinanceDashboard never called", async () => {
    mockAuth({ role: "external_auditor" })
    const getFinanceDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })

  test("a rank-1 role (client_viewer) is rejected with 403, getFinanceDashboard never called", async () => {
    mockAuth({ role: "client_viewer" })
    const getFinanceDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })

  test("the chosen floor role (member) succeeds and returns the dashboard", async () => {
    mockAuth({ role: "member" })
    const getFinanceDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getFinanceDashboard).toHaveBeenCalledWith({ orgId: "org-1" })
    expect(await res.json()).toEqual(FAKE_DASHBOARD)
  })

  test("a role above the floor (manager) also succeeds", async () => {
    mockAuth({ role: "manager" })
    const getFinanceDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getFinanceDashboard).toHaveBeenCalledWith({ orgId: "org-1" })
  })

  test("an API key without read scope is rejected with 403, getFinanceDashboard never called", async () => {
    mockAuth(null, { id: "key-1", name: "Test Key", scopes: ["write"] })
    const getFinanceDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })

  test("an API key with read scope succeeds", async () => {
    mockAuth(null, { id: "key-1", name: "Test Key", scopes: ["read"] })
    const getFinanceDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getFinanceDashboard).toHaveBeenCalledWith({ orgId: "org-1" })
  })

  test("an unauthenticated caller never reaches getFinanceDashboard", async () => {
    mockAuth(null, null, new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    const getFinanceDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(getFinanceDashboard).not.toHaveBeenCalled()
  })
})
