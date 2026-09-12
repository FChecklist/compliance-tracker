/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRole(dbUser, "manager")
// gate added to POST /api/reports/schedules -- this route previously had no
// role check at all beyond a real session. Matches metric-alert-rules's own
// requireRole(dbUser, "manager") gate (R75 Part 2 Phase 5 G8-misc) -- the
// most similar sibling feature: an org-wide, notifying report/alert
// definition. Mocks @/lib/supabase/auth-guard and
// @/lib/services/report-schedule-service (same convention as
// src/app/api/metric-alert-rules/route.test.ts).
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

function makeRequest(): Request {
  return new Request("http://localhost/api/reports/schedules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportId: "escalations", cadence: "daily", recipientUserIds: ["user-2"] }),
  })
}

// mock.module() replaces the WHOLE module for the whole test process -- the
// sibling [id]/route.test.ts imports updateReportSchedule/deleteReportSchedule
// from this same module, so spreading the real module first keeps those
// exports intact regardless of file/test run order.
async function mockService(createReportSchedule: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/report-schedule-service")
  mock.module("@/lib/services/report-schedule-service", () => ({ ...actual, createReportSchedule, ServiceError: FakeServiceError }))
}

describe("POST /api/reports/schedules (access control)", () => {
  test("a role below manager (member) is rejected with 403 and createReportSchedule is never called", async () => {
    const createReportSchedule = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createReportSchedule)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createReportSchedule).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and createReportSchedule is called", async () => {
    const createReportSchedule = mock(async () => ({ id: "schedule-1", reportId: "escalations" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createReportSchedule)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(createReportSchedule).toHaveBeenCalledTimes(1)
  })
})
