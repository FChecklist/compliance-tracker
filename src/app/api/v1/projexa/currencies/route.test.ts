/// <reference types="bun-types" />
// Regression test for R58 Lane 2 (API_READ_WITHOUT_ROLE_CHECK): GET
// /api/v1/projexa/currencies had no role floor at all -- any rank-1 role
// (viewer/client_viewer/external_auditor/stage_0, see ROLE_RANK in
// auth-guard.ts) could read it. Same isolation pattern as
// src/app/api/users/route.test.ts and
// src/app/api/v1/projexa/module-chain/route.test.ts: @/lib/supabase/auth-guard
// is mocked so this only proves the route's own access-control wiring, no
// live DB or real Supabase Auth needed. requireRoleOrScope's mock
// reimplements the REAL ROLE_RANK comparison (not just a canned true/false)
// so this test actually fails if the fix is reverted, rather than only
// testing that a call was made.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

const RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2,
  senior_professional: 3, manager: 3,
  branch_manager: 4,
  admin: 5,
  veridian_admin: 6,
}

function fakeRequireRoleOrScope(ctx: any, minimumRole: string) {
  if (!ctx.dbUser) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any
  const userRank = RANK[ctx.dbUser.role] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

// NOTE: neither mock spreads the real module's exports (unlike
// module-chain/route.test.ts's mockTree). erp-accounting-service.ts pulls in
// approval-workflow-service.ts et al., which transitively re-import
// hasRole/ROLE_RANK from this same auth-guard module and also trigger a live
// DB pool/env lookup at import time -- loading the real module here made this
// test try to hit a real database and hang. A route-shaped hand-rolled mock
// (only the exports currencies/route.ts itself actually imports) keeps this
// a pure unit test of the route's own access-control wiring, same posture as
// src/app/api/users/route.test.ts.
function mockAuth(role: string) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: "org-1",
      dbUser: { id: "user-1", role, orgId: "org-1" },
      apiKey: null,
      response: null,
    })),
    requireRoleOrScope: fakeRequireRoleOrScope,
  }))
}

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function mockList(currencies: unknown[]) {
  const listCurrencies = mock(async () => currencies)
  mock.module("@/lib/services/erp-accounting-service", () => ({ listCurrencies, ServiceError: FakeServiceError }))
  return listCurrencies
}

function getRequest() {
  return new NextRequest("http://localhost/api/v1/projexa/currencies", {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("GET /api/v1/projexa/currencies (access control -- R58 Lane 2 regression)", () => {
  test("a rank-1 role (external_auditor) is rejected with 403, listCurrencies never runs", async () => {
    mockAuth("external_auditor")
    const listCurrencies = mockList([{ id: "c1", code: "AED", name: "Dirham", symbol: "AED", isBaseCurrency: true }])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(listCurrencies).not.toHaveBeenCalled()
  })

  test("a rank-1 role (client_viewer) is also rejected with 403", async () => {
    mockAuth("client_viewer")
    const listCurrencies = mockList([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(listCurrencies).not.toHaveBeenCalled()
  })

  test("member (the chosen floor) succeeds and gets the mapped currency list", async () => {
    mockAuth("member")
    const listCurrencies = mockList([{ id: "c1", code: "AED", name: "Dirham", symbol: "AED", isBaseCurrency: true, someInternalField: "should not leak" }])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(listCurrencies).toHaveBeenCalledWith({ orgId: "org-1" })
    expect(await res.json()).toEqual({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: "AED", isBaseCurrency: true }] })
  })

  test("a role above the floor (admin) also succeeds", async () => {
    mockAuth("admin")
    const listCurrencies = mockList([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(listCurrencies).toHaveBeenCalled()
  })
})
