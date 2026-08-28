/// <reference types="bun-types" />
// R60 T7 (E-52 sweep, house-pattern "silent-empty-200"): GET previously
// returned 200 { totalProjects: 0, totalBudget: 0, totalRevenue: 0,
// totalExpenses: 0, projects: [] } when ctx.orgId was falsy -- on the first
// screen PROJEXA renders after login, a broken org context rendered
// identically to a legitimate, real, all-zero org. Fixed to a real 400, the
// same shape every sibling v1 GET with this guard now uses. Same
// mock.module convention as reports/catalog/route.test.ts: auth-guard and
// the service layer are both mocked, proving the route's own wiring, not a
// live DB.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
  }))
}

function mockService(implOverride?: () => Promise<unknown>) {
  const getOrgDashboard = mock(
    implOverride ?? (async () => ({ totalProjects: 0, totalBudget: 0, totalRevenue: 0, totalExpenses: 0, projects: [] }))
  )
  mock.module("@/lib/services/construction-dashboard-service", () => ({ getOrgDashboard, ServiceError }))
  return getOrgDashboard
}

function getRequest() {
  // Plain Request has no .nextUrl (that's a Next.js-specific NextRequest
  // extension) -- requireAuthOrApiKey is mocked above and never inspects
  // the request object itself, so a minimal stand-in carrying just the
  // .nextUrl the route body actually reads is enough here.
  return { nextUrl: new URL("http://localhost/api/v1/projexa/dashboard") }
}

describe("GET /api/v1/projexa/dashboard", () => {
  test("a caller with no resolvable org now gets 400, not a silent 200 all-zero dashboard", async () => {
    mockAuth({ orgId: null })
    const getOrgDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "No organisation on this account" })
    expect(getOrgDashboard).not.toHaveBeenCalled()
  })

  test("real case: authenticated + org resolved calls getOrgDashboard with the caller's own orgId", async () => {
    mockAuth({ orgId: "org-1" })
    const getOrgDashboard = mockService(async () => ({
      totalProjects: 3,
      totalBudget: 900000,
      totalRevenue: 450000,
      totalExpenses: 120000,
      projects: [{ id: "p-1" }],
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      totalProjects: 3,
      totalBudget: 900000,
      totalRevenue: 450000,
      totalExpenses: 120000,
      projects: [{ id: "p-1" }],
    })
    expect(getOrgDashboard).toHaveBeenCalledTimes(1)
    expect(getOrgDashboard.mock.calls[0][0]).toEqual({ orgId: "org-1" })
  })

  test("a rank-1 (viewer-tier) role is rejected by the role gate before getOrgDashboard runs", async () => {
    mockAuth({ orgId: "org-1", roleErr: new Response(JSON.stringify({ error: "Insufficient role" }), { status: 403 }) })
    const getOrgDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getOrgDashboard).not.toHaveBeenCalled()
  })
})
