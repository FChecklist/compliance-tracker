/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRole(dbUser, "manager")
// gate added to PATCH/DELETE /api/reports/definitions/[id] -- both
// previously had no role check at all beyond a real session. Same
// convention as the sibling route.test.ts (POST /api/reports/definitions)
// and src/app/api/metric-alert-rules/[id]/route.test.ts: mocks auth-guard
// and report-engine-service, proving only the route's own wiring.
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
  return new Request("http://localhost/api/reports/definitions/def-1", init)
}

// report-engine-service.ts's own dependency chain reaches at least one
// module that imports hasRole from auth-guard -- mock.module() replaces the
// whole module process-wide, so this must spread the REAL module's other
// exports rather than a bare object literal, or that unrelated import
// breaks (see the sibling route.test.ts's own comment on this).
async function mockAuthGuard(role: string) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(role), orgId: "org-1" })),
    requireRole: fakeRequireRole,
  }))
}

// mock.module() replaces the WHOLE module for the whole test process -- the
// sibling route.test.ts (POST /api/reports/definitions) imports
// createReportDefinition/listReportDefinitions from this same module, so
// spreading the real module first keeps those exports intact regardless of
// file/test run order.
async function mockServices(overrides: { updateReportDefinition?: any; deleteReportDefinition?: any } = {}) {
  const actual = await import("@/lib/services/report-engine-service")
  mock.module("@/lib/services/report-engine-service", () => ({
    ...actual,
    ServiceError: FakeServiceError,
    updateReportDefinition: overrides.updateReportDefinition ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
    deleteReportDefinition: overrides.deleteReportDefinition ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
  }))
}

describe("PATCH /api/reports/definitions/[id] (access control)", () => {
  test("a role below manager (member) is rejected with 403 and updateReportDefinition is never called", async () => {
    const updateReportDefinition = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    await mockAuthGuard("member")
    await mockServices({ updateReportDefinition })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(403)
    expect(updateReportDefinition).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and updateReportDefinition is called", async () => {
    const updateReportDefinition = mock(async () => ({ id: "def-1", name: "Renamed" }))
    await mockAuthGuard("manager")
    await mockServices({ updateReportDefinition })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(200)
    expect(updateReportDefinition).toHaveBeenCalledTimes(1)
  })
})

describe("DELETE /api/reports/definitions/[id] (access control)", () => {
  test("a role below manager (member) is rejected with 403 and deleteReportDefinition is never called", async () => {
    const deleteReportDefinition = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    await mockAuthGuard("member")
    await mockServices({ deleteReportDefinition })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(403)
    expect(deleteReportDefinition).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and deleteReportDefinition is called", async () => {
    const deleteReportDefinition = mock(async () => undefined)
    await mockAuthGuard("manager")
    await mockServices({ deleteReportDefinition })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "def-1" }) })
    expect(res.status).toBe(200)
    expect(deleteReportDefinition).toHaveBeenCalledTimes(1)
  })
})
