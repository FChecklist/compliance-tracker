/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 9 -- THE ANALYSIS SCREEN (spec Part F). Real,
// committed, re-runnable proof of 9-05 (GET-only), 9-06 (org-scoped), and
// 9-07 (client role refused at the ROUTE, not a hidden column).
//
// Deliberately mocks ONLY requireAuthOrApiKey (spreading the module's other
// real exports via `...actual`), NOT requireRoleOrScope itself -- so this
// test exercises the REAL requireRoleOrScope/hasRole/ROLE_RANK logic from
// auth-guard.ts against a real dbUser.role value, matching finance-
// dashboard/route.test.ts's own documented rationale: a test that stubbed
// requireRoleOrScope's return value instead would keep passing even if the
// route's own call to it were deleted.
import { describe, test as bunTest, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

// Same generous per-test timeout as finance-dashboard/route.test.ts, for the
// same documented reason: first-time transpilation of auth-guard.ts's real
// import graph can take well past bun:test's 5000ms default in this
// environment.
const test = (name: string, fn: () => Promise<void>) => bunTest(name, fn, 30000)

const FAKE_ROW = { projectId: "p1", projectName: "Oakwood Villa", contractValueNow: 100000 }
const FAKE_ROWS = [
  { projectId: "p1", projectName: "Oakwood Villa", actualProfit: { profitOnGross: 5000, profitOnGrossPercent: 5, profitOnNetReceivable: 4000, profitOnNetReceivablePercent: 4 } },
]

let currentAuthCtx: { orgId: string | null; dbUser: unknown; apiKey: unknown; response: Response | null }
let getProjectAnalysisMock = mock(async () => FAKE_ROW)
let listOrgAnalysisMock = mock(async () => FAKE_ROWS)
let sortAnalysisRowsCalls: unknown[] = []

const actualAuthGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...actualAuthGuard,
  requireAuthOrApiKey: mock(async () => currentAuthCtx),
}))

const actualAnalysisService = await import("@/lib/services/boq-analysis-service")
mock.module("@/lib/services/boq-analysis-service", () => ({
  ...actualAnalysisService,
  getProjectAnalysis: mock((...args: unknown[]) => getProjectAnalysisMock(...(args as []))),
  listOrgAnalysis: mock((...args: unknown[]) => listOrgAnalysisMock(...(args as []))),
  sortAnalysisRows: mock((rows: unknown, sortBy: unknown, direction: unknown) => {
    sortAnalysisRowsCalls.push({ rows, sortBy, direction })
    return rows
  }),
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

function resetServiceMocks() {
  getProjectAnalysisMock = mock(async () => FAKE_ROW)
  listOrgAnalysisMock = mock(async () => FAKE_ROWS)
  sortAnalysisRowsCalls = []
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/reports/boq-analysis${query}`)
}

describe("GET /api/v1/projexa/reports/boq-analysis -- 9-07 client role is REFUSED AT THE ROUTE", () => {
  test("a rank-1 role (client_viewer) is rejected with 403, neither service function is ever called", async () => {
    mockAuth({ role: "client_viewer" })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(getProjectAnalysisMock).not.toHaveBeenCalled()
    expect(listOrgAnalysisMock).not.toHaveBeenCalled()
  })

  test("a rank-1 role (viewer) is also rejected with 403 -- the floor is manager, stricter than this codebase's usual 'member' GET floor", async () => {
    mockAuth({ role: "viewer" })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(listOrgAnalysisMock).not.toHaveBeenCalled()
  })

  test("rank-2 (member) is ALSO rejected -- this screen's floor is manager, not this codebase's usual member GET floor", async () => {
    mockAuth({ role: "member" })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
  })

  test("the chosen floor role (manager) succeeds and returns the cross-project rows", async () => {
    mockAuth({ role: "manager" })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(listOrgAnalysisMock).toHaveBeenCalledWith({ orgId: "org-1" })
    expect(await res.json()).toEqual({ rows: FAKE_ROWS })
  })

  test("a role above the floor (admin) also succeeds", async () => {
    mockAuth({ role: "admin" })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
  })

  test("an API key without read scope is rejected with 403", async () => {
    mockAuth(null, { id: "key-1", name: "Test Key", scopes: ["write"] })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
  })

  test("an unauthenticated caller never reaches either service function", async () => {
    mockAuth(null, null, new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(getProjectAnalysisMock).not.toHaveBeenCalled()
    expect(listOrgAnalysisMock).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/projexa/reports/boq-analysis -- 9-01/9-02 per-project vs cross-project dispatch", () => {
  test("no projectId -> cross-project listing (9-02), sorted by the default key", async () => {
    mockAuth({ role: "manager" })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(getProjectAnalysisMock).not.toHaveBeenCalled()
    expect(listOrgAnalysisMock).toHaveBeenCalledTimes(1)
    expect(sortAnalysisRowsCalls).toEqual([{ rows: FAKE_ROWS, sortBy: "profitOnGross", direction: "desc" }])
  })

  test("a projectId query param -> the single-project view (9-01), listOrgAnalysis never called", async () => {
    mockAuth({ role: "manager" })
    resetServiceMocks()

    const { GET } = await import("./route")
    const res = await GET(getRequest("?projectId=p1") as any)

    expect(res.status).toBe(200)
    expect(getProjectAnalysisMock).toHaveBeenCalledWith({ orgId: "org-1" }, "p1")
    expect(listOrgAnalysisMock).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ row: FAKE_ROW })
  })

  test("an invalid sortBy value falls back to the default (profitOnGross) rather than erroring", async () => {
    mockAuth({ role: "manager" })
    resetServiceMocks()

    const { GET } = await import("./route")
    await GET(getRequest("?sortBy=not-a-real-key") as any)

    expect(sortAnalysisRowsCalls).toEqual([{ rows: FAKE_ROWS, sortBy: "profitOnGross", direction: "desc" }])
  })

  test("sortBy and direction query params are passed through when valid", async () => {
    mockAuth({ role: "manager" })
    resetServiceMocks()

    const { GET } = await import("./route")
    await GET(getRequest("?sortBy=profitOnGrossPercent&direction=asc") as any)

    expect(sortAnalysisRowsCalls).toEqual([{ rows: FAKE_ROWS, sortBy: "profitOnGrossPercent", direction: "asc" }])
  })
})

// 9-05: READ-ONLY -- this file exports no POST/PUT/PATCH/DELETE handler at
// all. Falsifiable by construction: importing any of those names from a
// file with no such export is `undefined`, not a silent pass-through.
describe("9-05 READ-ONLY -- no mutating handler exists on this route", () => {
  test("POST/PUT/PATCH/DELETE are all undefined", async () => {
    const routeModule = await import("./route")
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined()
    expect((routeModule as Record<string, unknown>).PUT).toBeUndefined()
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined()
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// FALSIFIABILITY (R74-RULING-03 (b)): this session temporarily changed this
// route's requireRoleOrScope(ctx, "manager", "read") call to
// requireRoleOrScope(ctx, "viewer", "read") -- re-ran `bun test --isolate
// src/app/api/v1/projexa/reports/boq-analysis/route.test.ts` and confirmed
// the "client_viewer"/"viewer"/"member" 403 tests above went RED (200
// instead of 403, the mocked service functions WERE called) -- then
// reverted the temporary edit (`git diff` on route.ts was byte-identical to
// the pre-edit committed version) and re-ran, confirming GREEN. Full
// verbatim RED output and the git-diff confirmation are in this PR's
// description, not duplicated here to avoid this comment drifting out of
// sync with the actual run.
// ─────────────────────────────────────────────────────────────────────────
