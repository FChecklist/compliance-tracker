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
    // R67 E-01/E-21 fix pass: isManager:false opts a test into the redaction
    // branch, so this route and its /api/construction/dashboard sibling
    // (which drifted on spendOverValue) are each pinned by a real test.
    hasRole: mock(() => ctx.isManager ?? true),
  }))
}

// R67 F-27 (R-243): the route now also serves ?projectIds=a,b,c from
// getProjectDashboards, so the module mock has to carry it -- a partial mock of
// a module the route imports is a SyntaxError at import time, not a soft miss.
let getProjectDashboards = mock(async (_ctx: { orgId: string }, _ids: string[]): Promise<unknown[]> => [])

function mockService(implOverride?: () => Promise<unknown>, batchImpl?: (ctx: { orgId: string }, ids: string[]) => Promise<unknown[]>) {
  const getOrgDashboard = mock(
    implOverride ?? (async () => ({ totalProjects: 0, totalBudget: 0, totalRevenue: 0, totalExpenses: 0, projects: [] }))
  )
  getProjectDashboards = mock(batchImpl ?? (async () => []))
  mock.module("@/lib/services/construction-dashboard-service", () => ({
    getOrgDashboard,
    getProjectDashboards,
    ServiceError,
  }))
  return getOrgDashboard
}

function getRequest(search = "") {
  // Plain Request has no .nextUrl (that's a Next.js-specific NextRequest
  // extension) -- requireAuthOrApiKey is mocked above and never inspects
  // the request object itself, so a minimal stand-in carrying just the
  // .nextUrl the route body actually reads is enough here.
  return { nextUrl: new URL(`http://localhost/api/v1/projexa/dashboard${search}`) }
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

  // R67 E-21 (R-195/R-204/R-205), field names as of the E-06/E-23 second
  // merge: getOrgDashboard's project rows gained contractValue,
  // earnedValuePrevWeek, ledgerBudget (E-23's ERP-ledger figure, distinct
  // from the BOQ-derived `budget`) and spent. Every one of those is a
  // financial figure, and F059 was precisely the case of a money field
  // reaching a member-rank caller because it was added to the service and
  // not to this list. This test is the guard: a below-manager caller sees no
  // money on a project row, and still sees their own schedule.
  test("below manager rank, EVERY money field on a project row is redacted -- including the ones E-21/E-23 added", async () => {
    mockAuth({ orgId: "org-1", isManager: false })
    mockService(async () => ({
      totalProjects: 1,
      totalBudget: 900000,
      totalRevenue: 450000,
      totalExpenses: 120000,
      projects: [
        {
          id: "p-1", name: "Cedar",
          revenue: 450000, expenses: 120000, spent: 120000,
          budget: 90000, ledgerBudget: 80000,
          value: 475000, contractValue: 475000,
          earnedValue: 118750, earnedValuePrevWeek: 95000, percentByValue: 25,
          progressPercent: 60, taskCount: 4, delayedTaskCount: 1,
          tasksDue: 3, tasksLate: 1, hasSchedule: true,
        },
      ],
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalBudget).toBeNull()
    expect(body.totalRevenue).toBeNull()
    expect(body.totalExpenses).toBeNull()

    const row = body.projects[0]
    for (const moneyField of [
      "revenue", "expenses", "spent", "budget", "ledgerBudget",
      "value", "contractValue", "earnedValue", "earnedValuePrevWeek", "percentByValue",
    ]) {
      expect(row[moneyField]).toBeNull()
    }

    // Not money, and a site engineer still needs it: the schedule stays.
    expect(row.progressPercent).toBe(60)
    expect(row.tasksLate).toBe(1)
    expect(row.tasksDue).toBe(3)
    expect(row.hasSchedule).toBe(true)
    expect(row.name).toBe("Cedar")
  })
})

// R67 F-27 (audit recommendation R-243) -- ?projectIds= answers a portfolio in
// ONE call. The per-project dashboard used to be one request per project, each
// of which was itself about ten sequential aggregates.
describe("GET /api/v1/projexa/dashboard?projectIds=", () => {
  const DASHBOARD = {
    projectId: "p-1",
    projectName: "Oakwood",
    budget: 100,
    revenue: 200,
    expenses: 50,
    projectValue: 300,
    earnedValue: 40,
    percentByValue: 20,
    contractValue: 200,
    taskCount: 4,
    delayedTaskCount: 1,
  }

  test("passes every id to the batch service in ONE call and returns them under `dashboards`", async () => {
    mockAuth({ orgId: "org-1" })
    const getOrgDashboard = mockService(undefined, async () => [DASHBOARD])

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=p-1,p-2,p-3") as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dashboards: [DASHBOARD] })
    expect(getProjectDashboards).toHaveBeenCalledTimes(1)
    expect(getProjectDashboards.mock.calls[0][0]).toEqual({ orgId: "org-1" })
    expect(getProjectDashboards.mock.calls[0][1]).toEqual(["p-1", "p-2", "p-3"])
    // The org-level summary is a different question and must not also run.
    expect(getOrgDashboard).not.toHaveBeenCalled()
  })

  test("whitespace and empty segments are trimmed rather than sent through as ids", async () => {
    mockAuth({ orgId: "org-1" })
    mockService(undefined, async () => [])

    const { GET } = await import("./route")
    await GET(getRequest("?projectIds=%20p-1%20,,%20p-2") as any)

    expect(getProjectDashboards.mock.calls[0][1]).toEqual(["p-1", "p-2"])
  })

  test("an empty projectIds is a 400, never a silent org-wide answer to a per-project question", async () => {
    mockAuth({ orgId: "org-1" })
    const getOrgDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=") as any)

    expect(res.status).toBe(400)
    expect(getOrgDashboard).not.toHaveBeenCalled()
    expect(getProjectDashboards).not.toHaveBeenCalled()
  })

  test("more than 50 ids is refused by name and number, not truncated silently", async () => {
    mockAuth({ orgId: "org-1" })
    mockService()

    const { GET } = await import("./route")
    const ids = Array.from({ length: 51 }, (_, i) => `p-${i}`).join(",")
    const res = await GET(getRequest(`?projectIds=${ids}`) as any)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("51")
    expect(getProjectDashboards).not.toHaveBeenCalled()
  })

  test("a below-manager caller gets task counts but no money -- the same F059 redaction the other two shapes apply", async () => {
    mockAuth({ orgId: "org-1" })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { id: "user-1" }, apiKey: null, response: null })),
      requireRoleOrScope: mock(() => null),
      hasRole: mock(() => false),
    }))
    mockService(undefined, async () => [DASHBOARD])

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=p-1") as any)

    const body = await res.json()
    expect(body.dashboards[0].budget).toBeNull()
    expect(body.dashboards[0].revenue).toBeNull()
    expect(body.dashboards[0].expenses).toBeNull()
    expect(body.dashboards[0].earnedValue).toBeNull()
    expect(body.dashboards[0].contractValue).toBeNull()
    // ...but the operational figures a site engineer needs are still there.
    expect(body.dashboards[0].taskCount).toBe(4)
    expect(body.dashboards[0].delayedTaskCount).toBe(1)
  })
})

// R67 F-27 (audit recommendation R-243) -- ?projectIds= answers a portfolio in
// ONE call. The per-project dashboard used to be one request per project, each
// of which was itself about ten sequential aggregates.
describe("GET /api/v1/projexa/dashboard?projectIds=", () => {
  const DASHBOARD = {
    projectId: "p-1",
    projectName: "Oakwood",
    budget: 100,
    revenue: 200,
    expenses: 50,
    projectValue: 300,
    earnedValue: 40,
    percentByValue: 20,
    contractValue: 200,
    taskCount: 4,
    delayedTaskCount: 1,
  }

  test("passes every id to the batch service in ONE call and returns them under `dashboards`", async () => {
    mockAuth({ orgId: "org-1" })
    const getOrgDashboard = mockService(undefined, async () => [DASHBOARD])

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=p-1,p-2,p-3") as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dashboards: [DASHBOARD] })
    expect(getProjectDashboards).toHaveBeenCalledTimes(1)
    expect(getProjectDashboards.mock.calls[0][0]).toEqual({ orgId: "org-1" })
    expect(getProjectDashboards.mock.calls[0][1]).toEqual(["p-1", "p-2", "p-3"])
    // The org-level summary is a different question and must not also run.
    expect(getOrgDashboard).not.toHaveBeenCalled()
  })

  test("whitespace and empty segments are trimmed rather than sent through as ids", async () => {
    mockAuth({ orgId: "org-1" })
    mockService(undefined, async () => [])

    const { GET } = await import("./route")
    await GET(getRequest("?projectIds=%20p-1%20,,%20p-2") as any)

    expect(getProjectDashboards.mock.calls[0][1]).toEqual(["p-1", "p-2"])
  })

  test("an empty projectIds is a 400, never a silent org-wide answer to a per-project question", async () => {
    mockAuth({ orgId: "org-1" })
    const getOrgDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=") as any)

    expect(res.status).toBe(400)
    expect(getOrgDashboard).not.toHaveBeenCalled()
    expect(getProjectDashboards).not.toHaveBeenCalled()
  })

  test("more than 50 ids is refused by name and number, not truncated silently", async () => {
    mockAuth({ orgId: "org-1" })
    mockService()

    const { GET } = await import("./route")
    const ids = Array.from({ length: 51 }, (_, i) => `p-${i}`).join(",")
    const res = await GET(getRequest(`?projectIds=${ids}`) as any)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("51")
    expect(getProjectDashboards).not.toHaveBeenCalled()
  })

  test("a below-manager caller gets task counts but no money -- the same F059 redaction the other two shapes apply", async () => {
    mockAuth({ orgId: "org-1" })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { id: "user-1" }, apiKey: null, response: null })),
      requireRoleOrScope: mock(() => null),
      hasRole: mock(() => false),
    }))
    mockService(undefined, async () => [DASHBOARD])

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=p-1") as any)

    const body = await res.json()
    expect(body.dashboards[0].budget).toBeNull()
    expect(body.dashboards[0].revenue).toBeNull()
    expect(body.dashboards[0].expenses).toBeNull()
    expect(body.dashboards[0].earnedValue).toBeNull()
    expect(body.dashboards[0].contractValue).toBeNull()
    // ...but the operational figures a site engineer needs are still there.
    expect(body.dashboards[0].taskCount).toBe(4)
    expect(body.dashboards[0].delayedTaskCount).toBe(1)
  })
})
