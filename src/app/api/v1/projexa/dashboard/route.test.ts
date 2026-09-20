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
// R-50 REOPENED FIX: the route no longer imports hasRole() -- it resolves a
// financial-visibility role via resolveActingUser() (the D-05 identity
// bridge) so a PROJEXA API-key caller is checked too, not just a session
// caller. mock.module() must spread the REAL module first or the route's
// real (non-role-gate) imports -- resolveActingUser/readActingUserId/
// readActingUserEmail -- silently disappear at module-link time, exactly the
// regression class boq-route.client-boundary.test.ts's own header documents.
import * as realAuthGuard from "@/lib/supabase/auth-guard"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: {
  orgId: string | null
  response?: Response | null
  roleErr?: Response | null
  /** Session (dbUser) caller's rank -- default true/"manager", matching this
   * file's original convention. Ignored when apiKeyOnly is set. */
  isManager?: boolean
  /** PROJEXA-style caller: a shared per-org API key, no session dbUser. */
  apiKeyOnly?: boolean
  /** The role resolveActingUser() resolves to for an apiKeyOnly caller (via
   * PROJEXA's X-Acting-User/X-Acting-User-Email headers) -- undefined/null
   * means resolution failed (no headers, unmapped id), which the route's
   * fail-closed default must treat as "no financial visibility". */
  actingRole?: string | null
}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...realAuthGuard,
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.apiKeyOnly
        ? null
        : ctx.orgId
          ? { id: "user-1", role: (ctx.isManager ?? true) ? "manager" : "member" }
          : null,
      apiKey: ctx.apiKeyOnly ? { id: "key-1", name: "test key", scopes: ["read", "write"] } : null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    // R48 gap-closure (2026-08-30, F059) x R-50 REOPENED FIX: the redaction
    // floor is "manager" rank, evaluated against whichever role the route
    // resolves -- ctx.dbUser.role directly for a session caller, or this
    // mock's `actingRole` (standing in for a real resolveActingUser() DB
    // lookup) for an apiKeyOnly caller, exactly like PROJEXA's real traffic.
    resolveActingUser: mock(async () => ({
      user: ctx.actingRole ? { id: "acting-1", role: ctx.actingRole } : null,
      error: null,
    })),
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

function getRequest(search = "", headers: Record<string, string> = {}) {
  // Plain Request has no .nextUrl (that's a Next.js-specific NextRequest
  // extension) -- requireAuthOrApiKey is mocked above and never inspects
  // the request object itself, so a minimal stand-in carrying just the
  // .nextUrl the route body actually reads is enough here. `.headers` is a
  // REAL Headers object (not mocked) because readActingUserId/
  // readActingUserEmail are the real, unmocked functions (spread in via
  // ...realAuthGuard above) and call request.headers.get(...) directly.
  return { nextUrl: new URL(`http://localhost/api/v1/projexa/dashboard${search}`), headers: new Headers(headers) }
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

  // R-50 REOPENED (platform.sumeet_requirements): a real, confirmed-live gap.
  // The OLD code gated redaction on `ctx.dbUser && !hasRole(ctx.dbUser,
  // "manager")` -- PROJEXA authenticates every call with a single shared
  // per-org API key, so ctx.dbUser was ALWAYS null for a PROJEXA-proxied
  // request and that `&&` never fired, for ANY role. This is the regression
  // test: it fails against the pre-fix logic (an apiKeyOnly caller got the
  // full, unredacted summary unconditionally) and passes against the fix
  // (a real role is resolved via resolveActingUser(), and the SAME "manager"
  // floor F059 always used is applied to it).
  test("R-50: an API-key (PROJEXA) caller resolving to client_viewer is redacted -- the hard floor holds over the real proxy path, not just a session", async () => {
    mockAuth({ orgId: "org-1", apiKeyOnly: true, actingRole: "client_viewer" })
    mockService(async () => ({
      totalProjects: 1,
      totalBudget: 900000,
      totalRevenue: 450000,
      totalExpenses: 120000,
      projects: [{
        id: "p-1", name: "Cedar Heights Villa",
        revenue: 450000, expenses: 700000, value: 600000, budget: 900000,
        earnedValue: 300000, percentByValue: 50, percentByActivity: 46,
      }],
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest("", { "x-acting-user-email": "karan.malhotra@example.com" }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalBudget).toBeNull()
    expect(body.totalRevenue).toBeNull()
    expect(body.totalExpenses).toBeNull()
    expect(body.financialsRedacted).toBe(true)
    expect(body.projects[0].revenue).toBeNull()
    expect(body.projects[0].earnedValue).toBeNull()
    expect(body.projects[0].percentByActivity).toBe(46) // not money -- stays
  })

  test("R-50: an API-key (PROJEXA) caller resolving to a manager/CEO-tier role sees the real figures -- the fix does not over-broaden the gate", async () => {
    mockAuth({ orgId: "org-1", apiKeyOnly: true, actingRole: "manager" })
    mockService(async () => ({
      totalProjects: 1,
      totalBudget: 900000,
      totalRevenue: 450000,
      totalExpenses: 120000,
      projects: [{ id: "p-1", name: "Cedar Heights Villa", revenue: 450000, budget: 900000 }],
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest("", { "x-acting-user-email": "ceo@example.com" }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalBudget).toBe(900000)
    expect(body.totalRevenue).toBe(450000)
    expect(body.projects[0].revenue).toBe(450000)
    expect(body.financialsRedacted).toBeUndefined()
  })

  test("R-50: an API-key caller with NO resolvable acting user (no headers, unmapped id) fails closed -- redacted, not an error", async () => {
    mockAuth({ orgId: "org-1", apiKeyOnly: true, actingRole: null })
    mockService(async () => ({
      totalProjects: 1,
      totalBudget: 900000,
      totalRevenue: 450000,
      totalExpenses: 120000,
      projects: [{ id: "p-1", name: "Cedar", revenue: 450000, budget: 900000 }],
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalBudget).toBeNull()
    expect(body.financialsRedacted).toBe(true)
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
    mockAuth({ orgId: "org-1", isManager: false })
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

  // R-50 REOPENED: the same real gap as the org-summary shape above, on the
  // batch/?projectIds= shape -- leaving this branch on the old
  // `ctx.dbUser && !hasRole(...)` check would have let client_viewer read
  // the identical figures straight through this endpoint even after the
  // org-summary branch was fixed.
  test("R-50: an API-key (PROJEXA) caller resolving to client_viewer is redacted on the batch shape too", async () => {
    mockAuth({ orgId: "org-1", apiKeyOnly: true, actingRole: "client_viewer" })
    mockService(undefined, async () => [DASHBOARD])

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=p-1", { "x-acting-user-email": "karan.malhotra@example.com" }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dashboards[0].budget).toBeNull()
    expect(body.dashboards[0].revenue).toBeNull()
    expect(body.dashboards[0].earnedValue).toBeNull()
    expect(body.dashboards[0].contractValue).toBeNull()
    expect(body.dashboards[0].taskCount).toBe(4) // not money -- stays
  })

  test("R-50: an API-key (PROJEXA) caller resolving to manager sees the real batch figures", async () => {
    mockAuth({ orgId: "org-1", apiKeyOnly: true, actingRole: "manager" })
    mockService(undefined, async () => [DASHBOARD])

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectIds=p-1", { "x-acting-user-email": "ceo@example.com" }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dashboards[0].budget).toBe(100)
    expect(body.dashboards[0].revenue).toBe(200)
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
    mockAuth({ orgId: "org-1", isManager: false })
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
