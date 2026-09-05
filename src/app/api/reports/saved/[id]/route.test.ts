/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRole(dbUser, "member")
// gate added to PATCH/DELETE /api/reports/saved/[id] -- both previously had
// no role check at all beyond a real session. Same convention as the
// sibling route.test.ts (POST /api/reports/saved) and
// src/app/api/metric-alert-rules/[id]/route.test.ts: mocks auth-guard and
// custom-report-service, proving only the route's own wiring.
import { describe, test, expect, mock } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const userRank = ROLE_RANK[user?.role as keyof typeof ROLE_RANK] ?? 0
  const requiredRank = ROLE_RANK[minimumRole as keyof typeof ROLE_RANK] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function makeRequest(method: string): Request {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } }
  if (method === "PATCH") init.body = JSON.stringify({ name: "Renamed" })
  return new Request("http://localhost/api/reports/saved/report-1", init)
}

// mock.module() replaces the WHOLE module for the whole test process -- the
// sibling route.test.ts (POST /api/reports/saved) imports
// createSavedReport/listSavedReports from this same module, so spreading
// the real module first keeps those exports intact regardless of file/test
// run order.
async function mockServices(overrides: { updateSavedReport?: any; deleteSavedReport?: any } = {}) {
  const actual = await import("@/lib/services/custom-report-service")
  mock.module("@/lib/services/custom-report-service", () => ({
    ...actual,
    ServiceError: FakeServiceError,
    updateSavedReport: overrides.updateSavedReport ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
    deleteSavedReport: overrides.deleteSavedReport ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
  }))
}

describe("PATCH /api/reports/saved/[id] (access control)", () => {
  test("a viewer (below member) is rejected with 403 and updateSavedReport is never called", async () => {
    const updateSavedReport = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ updateSavedReport })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "report-1" }) })
    expect(res.status).toBe(403)
    expect(updateSavedReport).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and updateSavedReport is called", async () => {
    const updateSavedReport = mock(async () => ({ id: "report-1", name: "Renamed" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ updateSavedReport })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "report-1" }) })
    expect(res.status).toBe(200)
    expect(updateSavedReport).toHaveBeenCalledTimes(1)
  })
})

describe("DELETE /api/reports/saved/[id] (access control)", () => {
  test("a viewer (below member) is rejected with 403 and deleteSavedReport is never called", async () => {
    const deleteSavedReport = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ deleteSavedReport })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "report-1" }) })
    expect(res.status).toBe(403)
    expect(deleteSavedReport).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and deleteSavedReport is called", async () => {
    const deleteSavedReport = mock(async () => undefined)
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ deleteSavedReport })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "report-1" }) })
    expect(res.status).toBe(200)
    expect(deleteSavedReport).toHaveBeenCalledTimes(1)
  })
})
