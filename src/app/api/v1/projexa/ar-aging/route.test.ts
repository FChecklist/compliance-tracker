/// <reference types="bun-types" />
// R58 Lane 2 (API_READ_WITHOUT_ROLE_CHECK, 2026-08-27): regression test for
// the role floor added to GET /api/v1/projexa/ar-aging. Only
// requireAuthOrApiKey is mocked (it needs a real Supabase session/DB to
// resolve) -- requireRoleOrScope is imported from the REAL auth-guard module
// via the spread-actual pattern, so this exercises the real ROLE_RANK
// comparison end-to-end, not a mock standing in for it. Matches this
// codebase's established convention of testing gates against the live
// primitives (see permission-service.test.ts's header comment and
// lib/supabase/auth-guard.test.ts) rather than reimplementing/mocking the
// rank comparison, while still following module-chain/route.test.ts's
// route-level mock.module shape for the auth entry point and the service
// call.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"
import type { UserRole } from "@/lib/supabase/auth-guard"

type DbUser = { role: UserRole }

async function mockAuth(ctx: { orgId: string | null; role?: UserRole; response?: Response | null }) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.role ? ({ role: ctx.role } as unknown as DbUser) : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
  }))
}

const sampleReport = {
  asOfDate: "2026-08-27",
  buckets: { current: 0, d1_30: 1000, d31_60: 0, d61_90: 0, d90Plus: 0 },
  totalOutstanding: 1000,
  invoices: [
    { invoiceId: "inv-1", invoiceNumber: "INV-001", customerId: "cust-1", customerName: "Acme Co", dueDate: "2026-08-01", postingDate: "2026-07-01", outstandingAmount: "1000", daysOverdue: 26, bucket: "1-30", status: "overdue" },
  ],
}

async function mockReport() {
  const arAgingReport = mock(async () => sampleReport)
  const actual = await import("@/lib/services/erp-invoicing-service")
  mock.module("@/lib/services/erp-invoicing-service", () => ({ ...actual, arAgingReport }))
  return arAgingReport
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/ar-aging${query}`, {
    headers: { cookie: "" },
  })
}

describe("GET /api/v1/projexa/ar-aging", () => {
  test("a rank-1 role (external_auditor) is blocked with 403, arAgingReport is never called -- exposing real customer AR balances to the most-restricted tier is the exact gap this closes", async () => {
    await mockAuth({ orgId: "org-1", role: "external_auditor" })
    const arAgingReport = await mockReport()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(arAgingReport).not.toHaveBeenCalled()
  })

  test("a rank-1 role (client_viewer) is blocked with 403", async () => {
    await mockAuth({ orgId: "org-1", role: "client_viewer" })
    const arAgingReport = await mockReport()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(arAgingReport).not.toHaveBeenCalled()
  })

  test("the chosen floor role (member) is let through and receives the real report", async () => {
    await mockAuth({ orgId: "org-1", role: "member" })
    const arAgingReport = await mockReport()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(arAgingReport).toHaveBeenCalledWith({ orgId: "org-1" }, undefined)
    expect(await res.json()).toEqual(sampleReport)
  })

  test("a role above the floor (manager) is also let through", async () => {
    await mockAuth({ orgId: "org-1", role: "manager" })
    const arAgingReport = await mockReport()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(arAgingReport).toHaveBeenCalled()
  })

  test("an invalid/missing session never reaches arAgingReport", async () => {
    await mockAuth({ orgId: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) })
    const arAgingReport = await mockReport()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(arAgingReport).not.toHaveBeenCalled()
  })
})
