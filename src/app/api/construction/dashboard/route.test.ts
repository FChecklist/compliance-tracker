/// <reference types="bun-types" />
// R48 gap-closure F059 ("MEMBER cannot see budget or margin"), re-pinned in the
// R67 E-01/E-06 fix pass.
//
// This route and src/app/api/v1/projexa/dashboard/route.ts return the SAME
// getOrgDashboard payload behind the SAME redaction rule, and they drifted:
// E-01 added `spendOverValue` (a boolean meaning "expenses have passed the
// contract value") to every project row, the v1 route redacted it with a
// written reason, and this one carried it through untouched via the object
// spread -- handing a member the exact comparison that redacting revenue,
// expenses and budget exists to withhold, alongside the `value` that is also
// spread through.
//
// A field-by-field assertion, not a spot check: the point is that adding a
// financial figure to the payload must fail here until it is redacted here too.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** The shape getOrgDashboard really returns, with one project row. */
function summary() {
  return {
    totalProjects: 1,
    totalBudget: 900000,
    totalLedgerBudget: 250000,
    totalRevenue: 450000,
    totalExpenses: 700000,
    projects: [
      {
        id: "p-1",
        name: "Cedar Heights Villa",
        revenue: 450000,
        expenses: 700000,
        taskCount: 12,
        delayedTaskCount: 3,
        value: 600000,
        budget: 900000,
        earnedValue: 300000,
        percentByValue: 50,
        percentByActivity: 46,
        // expenses (700000) > value (600000): the verdict a member must not read
        spendOverValue: true,
        permitsExpiring30d: 2,
        lastProgressAt: "2026-09-01",
      },
    ],
  }
}

function mockAuth(isManager: boolean) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, orgId: "org-1", dbUser: { id: "u-1" } })),
    hasRole: mock(() => isManager),
  }))
}

function mockService() {
  const getOrgDashboard = mock(async () => summary())
  mock.module("@/lib/services/construction-dashboard-service", () => ({ getOrgDashboard, ServiceError }))
  return getOrgDashboard
}

function getRequest() {
  // requireAuth is mocked and never inspects the request; the route body reads
  // only .nextUrl.searchParams.
  return { nextUrl: new URL("http://localhost/api/construction/dashboard") }
}

describe("GET /api/construction/dashboard: financial redaction below manager rank", () => {
  test("a member gets every financial figure as null -- including the spend-over-value VERDICT", async () => {
    mockAuth(false)
    mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalBudget).toBeNull()
    expect(body.totalLedgerBudget).toBeNull()
    expect(body.totalRevenue).toBeNull()
    expect(body.totalExpenses).toBeNull()
    // Distinguishes "you may not see this" from "there is no BOQ".
    expect(body.financialsRedacted).toBe(true)

    const row = body.projects[0]
    expect(row.revenue).toBeNull()
    expect(row.expenses).toBeNull()
    expect(row.earnedValue).toBeNull()
    expect(row.percentByValue).toBeNull()
    expect(row.budget).toBeNull()
    // The regression this file exists for. null, NOT false: false would be a
    // claim about the project's finances, which is the thing being withheld.
    expect(row.spendOverValue).toBeNull()

    // Non-financial figures a site engineer's job depends on survive.
    expect(row.percentByActivity).toBe(46)
    expect(row.permitsExpiring30d).toBe(2)
    expect(row.delayedTaskCount).toBe(3)
    expect(row.name).toBe("Cedar Heights Villa")
  })

  test("a manager gets the payload unredacted, exactly as the service returned it", async () => {
    mockAuth(true)
    mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(summary())
    expect(body.financialsRedacted).toBeUndefined()
  })
})
