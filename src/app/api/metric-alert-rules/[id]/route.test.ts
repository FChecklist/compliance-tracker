/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRole(dbUser, "manager")
// gate added to PATCH/DELETE /api/metric-alert-rules/[id] -- both previously
// had no role check at all beyond a real session. Same convention as the
// sibling route.test.ts (POST /api/metric-alert-rules) and
// pms/time-entries/[id]/approve/route.test.ts: mocks auth-guard and
// metric-alert-service, proving only the route's own wiring.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makeRequest(method: string): Request {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } }
  if (method === "PATCH") init.body = JSON.stringify({ name: "Renamed" })
  return new Request("http://localhost/api/metric-alert-rules/rule-1", init)
}

// mock.module() replaces the WHOLE module for the whole test process (see
// src/app/api/me/route.test.ts's own header) -- the sibling route.test.ts
// (POST /api/metric-alert-rules) imports createMetricAlertRule/
// listMetricAlertRules from this same module, so spreading the real module
// first keeps those exports intact regardless of file/test run order.
async function mockServices(overrides: { updateMetricAlertRule?: any; deleteMetricAlertRule?: any } = {}) {
  const actual = await import("@/lib/services/metric-alert-service")
  mock.module("@/lib/services/metric-alert-service", () => ({
    ...actual,
    updateMetricAlertRule: overrides.updateMetricAlertRule ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
    deleteMetricAlertRule: overrides.deleteMetricAlertRule ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
  }))
}

describe("PATCH /api/metric-alert-rules/[id] (access control)", () => {
  test("a role below manager (member) is rejected with 403 and updateMetricAlertRule is never called", async () => {
    const updateMetricAlertRule = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ updateMetricAlertRule })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(403)
    expect(updateMetricAlertRule).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and updateMetricAlertRule is called", async () => {
    const updateMetricAlertRule = mock(async () => ({ id: "rule-1", name: "Renamed" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ updateMetricAlertRule })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(200)
    expect(updateMetricAlertRule).toHaveBeenCalledTimes(1)
  })
})

describe("DELETE /api/metric-alert-rules/[id] (access control)", () => {
  test("a role below manager (member) is rejected with 403 and deleteMetricAlertRule is never called", async () => {
    const deleteMetricAlertRule = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ deleteMetricAlertRule })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(403)
    expect(deleteMetricAlertRule).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and deleteMetricAlertRule is called", async () => {
    const deleteMetricAlertRule = mock(async () => undefined)
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ deleteMetricAlertRule })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "rule-1" }) })
    expect(res.status).toBe(200)
    expect(deleteMetricAlertRule).toHaveBeenCalledTimes(1)
  })
})
