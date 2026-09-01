/// <reference types="bun-types" />
// R58 Lane 2 regression test (API_READ_WITHOUT_ROLE_CHECK): this GET route
// used to call only requireAuthOrApiKey() with no role/scope floor at all,
// so any rank-1 role (viewer/client_viewer/external_auditor/stage_0, see
// ROLE_RANK in auth-guard.ts) could read real GL money figures (per-category
// subledger gross cost/accumulated depreciation/NBV and the mapped GL
// account's actual posted balance/variance). Fix: requireRoleOrScope(ctx,
// "member", "read"), matching the exact pattern already used by 13 sibling
// /api/v1/projexa/** GET routes.
//
// Same isolation pattern as src/app/api/users/route.test.ts's OCID-047
// regression test: @/lib/supabase/auth-guard is mocked with a fake
// requireRoleOrScope that reimplements the REAL ROLE_RANK arithmetic
// (copied verbatim from auth-guard.ts) instead of just returning a canned
// 403/null -- so this test exercises the actual rank hierarchy for every
// role tested, and captures the exact minimumRole the route passes in. That
// makes it fail red for three independent reasons if the fix regresses:
// (1) the route stops calling requireRoleOrScope at all (revert case) --
// the fake never runs, so a rank-1 role sees 200 instead of 403; (2) the
// route calls it with a floor at or below "viewer"/"client_viewer"/
// "external_auditor"/"stage_0" (rank 1) -- fakeRequireRoleOrScope would let
// rank-1 through; (3) the route calls it with "write" scope -- the "no
// scopes" apiKey case would then wrongly reject a real logged-in session
// (sessions always pass -- see hasScope()'s own doc comment in auth-guard.ts).
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

// Copied verbatim from ROLE_RANK in src/lib/supabase/auth-guard.ts.
const RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2,
  senior_professional: 3, manager: 3,
  branch_manager: 4,
  admin: 5,
  veridian_admin: 6,
}

function fakeRequireRoleOrScope(ctx: any, minimumRole: string) {
  if (ctx.dbUser) {
    const userRank = RANK[ctx.dbUser.role] ?? 0
    const requiredRank = RANK[minimumRole] ?? 99
    if (userRank < requiredRank) {
      return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 })
    }
    return null
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
}

function mockAuth(role: string | null, orgId: string | null = "org-1") {
  const roleErrSpy = mock(fakeRequireRoleOrScope)
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId,
      dbUser: role ? { id: "user-1", role, orgId, email: "test@veridian-test.internal" } : null,
      apiKey: null,
      response: null,
    })),
    requireRoleOrScope: roleErrSpy,
  }))
  return roleErrSpy
}

function mockAuthUnauthenticated() {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: null,
      dbUser: null,
      apiKey: null,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    })),
    requireRoleOrScope: mock(fakeRequireRoleOrScope),
  }))
}

function mockReport(report: unknown) {
  const assetToGlReconciliation = mock(async () => report)
  mock.module("@/lib/services/erp-fixed-assets-service", () => ({
    assetToGlReconciliation,
    ServiceError: class ServiceError extends Error {
      status: number
      constructor(message: string, status: number) {
        super(message)
        this.status = status
      }
    },
  }))
  return assetToGlReconciliation
}

function getRequest() {
  return new NextRequest("http://localhost/api/v1/projexa/asset-to-gl-reconciliation", {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("GET /api/v1/projexa/asset-to-gl-reconciliation (role gate, R58 Lane 2)", () => {
  test("external_auditor (rank 1) is blocked with 403, real GL figures never leave the service call", async () => {
    const roleErrSpy = mockAuth("external_auditor")
    const svc = mockReport({ lines: [{ categoryName: "Vehicles", totalNbvVariance: 12345 }] })

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(svc).not.toHaveBeenCalled()
    // Confirms the route asks for at least "member" -- a floor of "viewer"/
    // "client_viewer"/"external_auditor"/"stage_0" (rank 1) would let this
    // same caller through, defeating the fix's purpose.
    expect(roleErrSpy).toHaveBeenCalledWith(expect.anything(), expect.not.stringMatching(/^(viewer|client_viewer|external_auditor|stage_0)$/), "read")
  })

  test("client_viewer (rank 1) is blocked with 403", async () => {
    mockAuth("client_viewer")
    const svc = mockReport({ lines: [] })

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(svc).not.toHaveBeenCalled()
  })

  test("stage_0 (rank 1) is blocked with 403", async () => {
    mockAuth("stage_0")
    const svc = mockReport({ lines: [] })

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(svc).not.toHaveBeenCalled()
  })

  test("member (rank 2, the chosen floor) succeeds and receives the real report", async () => {
    mockAuth("member")
    const report = { lines: [{ categoryName: "Vehicles", totalNbvVariance: 0 }], isFullyReconciled: true }
    const svc = mockReport(report)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(svc).toHaveBeenCalledWith({ orgId: "org-1" }, { asOfDate: undefined })
    expect(await res.json()).toEqual(report)
  })

  test("manager (rank 3, above the floor) also succeeds", async () => {
    mockAuth("manager")
    const svc = mockReport({ lines: [] })

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(svc).toHaveBeenCalled()
  })

  test("an unauthenticated caller is rejected with 401 before the role gate, service never called", async () => {
    mockAuthUnauthenticated()
    const svc = mockReport({ lines: [] })

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(svc).not.toHaveBeenCalled()
  })
})
