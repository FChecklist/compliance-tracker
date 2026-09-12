/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRole(dbUser, "manager")
// gate added to PATCH/DELETE /api/reports/schedules/[id] -- both previously
// had no role check at all beyond a real session. Same convention as the
// sibling route.test.ts (POST /api/reports/schedules) and
// src/app/api/metric-alert-rules/[id]/route.test.ts: mocks auth-guard and
// report-schedule-service, proving only the route's own wiring.
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
  if (method === "PATCH") init.body = JSON.stringify({ cadence: "weekly" })
  return new Request("http://localhost/api/reports/schedules/schedule-1", init)
}

// mock.module() replaces the WHOLE module for the whole test process -- the
// sibling route.test.ts (POST /api/reports/schedules) imports
// createReportSchedule/listReportSchedules from this same module, so
// spreading the real module first keeps those exports intact regardless of
// file/test run order.
async function mockServices(overrides: { updateReportSchedule?: any; deleteReportSchedule?: any } = {}) {
  const actual = await import("@/lib/services/report-schedule-service")
  mock.module("@/lib/services/report-schedule-service", () => ({
    ...actual,
    ServiceError: FakeServiceError,
    updateReportSchedule: overrides.updateReportSchedule ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
    deleteReportSchedule: overrides.deleteReportSchedule ?? mock(async () => { throw new Error("should not be called for a below-minimum role") }),
  }))
}

describe("PATCH /api/reports/schedules/[id] (access control)", () => {
  test("a role below manager (member) is rejected with 403 and updateReportSchedule is never called", async () => {
    const updateReportSchedule = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ updateReportSchedule })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "schedule-1" }) })
    expect(res.status).toBe(403)
    expect(updateReportSchedule).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and updateReportSchedule is called", async () => {
    const updateReportSchedule = mock(async () => ({ id: "schedule-1", cadence: "weekly" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ updateReportSchedule })
    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH") as any, { params: Promise.resolve({ id: "schedule-1" }) })
    expect(res.status).toBe(200)
    expect(updateReportSchedule).toHaveBeenCalledTimes(1)
  })
})

describe("DELETE /api/reports/schedules/[id] (access control)", () => {
  test("a role below manager (member) is rejected with 403 and deleteReportSchedule is never called", async () => {
    const deleteReportSchedule = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ deleteReportSchedule })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "schedule-1" }) })
    expect(res.status).toBe(403)
    expect(deleteReportSchedule).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and deleteReportSchedule is called", async () => {
    const deleteReportSchedule = mock(async () => undefined)
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockServices({ deleteReportSchedule })
    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params: Promise.resolve({ id: "schedule-1" }) })
    expect(res.status).toBe(200)
    expect(deleteReportSchedule).toHaveBeenCalledTimes(1)
  })
})
