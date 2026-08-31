/// <reference types="bun-types" />
// API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27): this GET had no role
// floor at all -- ANY authenticated caller, including a rank-1 role
// (viewer/client_viewer/external_auditor/stage_0, see ROLE_RANK in
// auth-guard.ts), could read every cost center. Fix adds
// requireRoleOrScope(ctx, "member", "read"), the same floor already used by
// 10+ sibling /api/v1/projexa/** GET routes (employees, vendors, dashboard --
// see #1399).
//
// Deliberately does NOT mock requireRoleOrScope itself (unlike
// module-chain/route.test.ts's mockAuth helper) -- only requireAuthOrApiKey
// is replaced, requireRoleOrScope/requireRole/hasRole/ROLE_RANK are the real
// implementations from auth-guard.ts. That means this test exercises the
// real rank hierarchy end-to-end and genuinely fails if the fix is reverted
// (a reverted route never calls the gate, so even a rank-1 dbUser falls
// through to a 200), not just "the route respects whatever the gate says."
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"
import type { CombinedAuthContext } from "@/lib/supabase/auth-guard"

async function mockAuth(ctx: CombinedAuthContext) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({ ...actual, requireAuthOrApiKey: mock(async () => ctx) }))
}

function sessionCtx(role: string): CombinedAuthContext {
  return { orgId: "org-1", dbUser: { role } as any, apiKey: null, response: null }
}

async function mockCostCenters(rows: unknown[]) {
  const listCostCenters = mock(async () => rows)
  const actual = await import("@/lib/services/erp-accounting-service")
  mock.module("@/lib/services/erp-accounting-service", () => ({ ...actual, listCostCenters }))
  return listCostCenters
}

function getRequest() {
  return new NextRequest("http://localhost/api/v1/projexa/cost-centers", {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("GET /api/v1/projexa/cost-centers", () => {
  test("a rank-1 role (external_auditor) is blocked with 403, listCostCenters is never called", async () => {
    await mockAuth(sessionCtx("external_auditor"))
    const listCostCenters = await mockCostCenters([{ id: "cc-1", name: "HQ", parentCostCenterId: null, isGroup: false, departmentId: null, projectId: null }])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(listCostCenters).not.toHaveBeenCalled()
  }, 30000)

  test("a rank-1 role (client_viewer) is blocked with 403, listCostCenters is never called", async () => {
    await mockAuth(sessionCtx("client_viewer"))
    const listCostCenters = await mockCostCenters([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(listCostCenters).not.toHaveBeenCalled()
  }, 30000)

  test("the chosen floor (member) succeeds and returns the cost centers", async () => {
    await mockAuth(sessionCtx("member"))
    const rows = [{ id: "cc-1", name: "HQ", parentCostCenterId: null, isGroup: false, departmentId: null, projectId: null }]
    const listCostCenters = await mockCostCenters(rows)

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(listCostCenters).toHaveBeenCalledWith({ orgId: "org-1" })
    expect(await res.json()).toEqual({ costCenters: rows })
  }, 30000)

  test("a role above the floor (admin) also succeeds", async () => {
    await mockAuth(sessionCtx("admin"))
    const listCostCenters = await mockCostCenters([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(listCostCenters).toHaveBeenCalled()
  }, 30000)

  test("an invalid/missing session never reaches listCostCenters", async () => {
    await mockAuth({ orgId: null, dbUser: null, apiKey: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any })
    const listCostCenters = await mockCostCenters([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(listCostCenters).not.toHaveBeenCalled()
  }, 30000)
})
