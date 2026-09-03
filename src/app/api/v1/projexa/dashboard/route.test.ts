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

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null; isManager?: boolean }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    // R48 gap-closure (2026-08-30, F059): the route now also imports
    // hasRole() to redact financial fields below "manager" rank. These
    // tests are about the org-resolution/role-gate guards above, not the
    // redaction feature itself, so the mock defaults to true -- every
    // existing assertion here (checking the full, unredacted
    // getOrgDashboard result is returned) keeps its original meaning.
    // R67 E-01 fix pass: isManager:false opts one test into the redaction
    // branch, so this route and its /api/construction/dashboard sibling
    // (which drifted on spendOverValue) are each pinned by a real test.
    hasRole: mock(() => ctx.isManager ?? true),
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

  test("a member below manager rank gets every financial figure as null, the spend-over-value verdict included", async () => {
    // R48 gap-closure F059, re-pinned in the R67 E-01/E-06 fix pass. The
    // sibling /api/construction/dashboard route returns this same payload
    // behind this same rule and had NOT redacted spendOverValue; the two
    // assertions now exist side by side so they cannot drift again.
    mockAuth({ orgId: "org-1", isManager: false })
    mockService(async () => ({
      totalProjects: 1,
      totalBudget: 900000,
      totalLedgerBudget: 250000,
      totalRevenue: 450000,
      totalExpenses: 700000,
      projects: [{
        id: "p-1", name: "Cedar Heights Villa",
        revenue: 450000, expenses: 700000, value: 600000, budget: 900000,
        earnedValue: 300000, percentByValue: 50, percentByActivity: 46,
        spendOverValue: true, permitsExpiring30d: 2, delayedTaskCount: 3,
      }],
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalBudget).toBeNull()
    expect(body.totalLedgerBudget).toBeNull()
    expect(body.totalRevenue).toBeNull()
    expect(body.totalExpenses).toBeNull()
    expect(body.financialsRedacted).toBe(true)
    const row = body.projects[0]
    expect(row.revenue).toBeNull()
    expect(row.expenses).toBeNull()
    expect(row.earnedValue).toBeNull()
    expect(row.percentByValue).toBeNull()
    expect(row.budget).toBeNull()
    // null, NOT false -- false would itself be a claim about the finances.
    expect(row.spendOverValue).toBeNull()
    // Non-financial figures survive: a site engineer's job depends on both.
    expect(row.percentByActivity).toBe(46)
    expect(row.permitsExpiring30d).toBe(2)
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
