/// <reference types="bun-types" />
// R58 Lane 2 (API_READ_WITHOUT_ROLE_CHECK): proves GET /api/v1/projexa/
// customer-payment-behavior actually enforces requireRoleOrScope(ctx,
// "member", "read") end-to-end, not just that the route "respects a mock".
// requireAuthOrApiKey is mocked (no real Supabase session/DB needed to
// build a dbUser), but requireRoleOrScope below is the REAL implementation
// imported from auth-guard.ts before any mock.module call -- so this
// exercises the real hasRole()/ROLE_RANK logic the fix depends on. Same
// "real dbUser object literal, no DB" posture as auth-guard.test.ts's own
// sessionCtx()/apiKeyCtx() helpers.
//
// Reverting the fix (deleting the `const roleErr = requireRoleOrScope(...)`
// gate in route.ts) makes the rank-1 tests below fail: a real
// external_auditor/client_viewer dbUser would get a 200 with the real
// report body instead of 403 -- verified directly (see PR description).
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"
import { requireRoleOrScope as realRequireRoleOrScope } from "@/lib/supabase/auth-guard"

function mockAuth(role: string | null) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: role ? "org-1" : null,
      dbUser: role ? ({ id: "user-1", role } as any) : null,
      apiKey: null,
      response: null,
    })),
    // The REAL gate -- not a stand-in that always returns null/an error.
    requireRoleOrScope: realRequireRoleOrScope,
  }))
}

async function mockReport(report: unknown) {
  const customerPaymentBehaviorReport = mock(async () => report)
  const actual = await import("@/lib/services/erp-invoicing-service")
  mock.module("@/lib/services/erp-invoicing-service", () => ({ ...actual, customerPaymentBehaviorReport }))
  return customerPaymentBehaviorReport
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/customer-payment-behavior${query}`, {
    headers: { authorization: "Bearer vk_test" },
  })
}

const SAMPLE_REPORT = {
  asOfDate: "2026-08-27",
  periodDays: 90,
  customers: [
    { customerId: "cust-1", customerName: "Acme Constructions", outstandingAR: 125000, dso: 42.3 },
  ],
}

describe("GET /api/v1/projexa/customer-payment-behavior", () => {
  test("a rank-1 external_auditor is blocked with 403, the real report is never generated", async () => {
    mockAuth("external_auditor")
    const customerPaymentBehaviorReport = await mockReport(SAMPLE_REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(customerPaymentBehaviorReport).not.toHaveBeenCalled()
  })

  test("a rank-1 client_viewer is blocked with 403, the real report is never generated", async () => {
    mockAuth("client_viewer")
    const customerPaymentBehaviorReport = await mockReport(SAMPLE_REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(customerPaymentBehaviorReport).not.toHaveBeenCalled()
  })

  test("a rank-2 member (the chosen floor) succeeds and gets the real report body", async () => {
    mockAuth("member")
    const customerPaymentBehaviorReport = await mockReport(SAMPLE_REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(customerPaymentBehaviorReport).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual(SAMPLE_REPORT)
  })

  test("a rank-3 manager (above the floor) also succeeds", async () => {
    mockAuth("manager")
    const customerPaymentBehaviorReport = await mockReport(SAMPLE_REPORT)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(customerPaymentBehaviorReport).toHaveBeenCalledTimes(1)
  })
})
