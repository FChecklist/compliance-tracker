/// <reference types="bun-types" />
// Design Studio timesheets (Owner item 12, "IMPORTANT", 2026-07-28): proves
// this route's own access-control wiring -- only a manager-rank (or above)
// user reaches approveTimeEntry() at all -- the same pattern
// src/app/api/settings/branding/route.test.ts uses to test its
// requireRole(dbUser, "admin") gate. @/lib/supabase/auth-guard and
// pms-time-service/pms-enablement-service are mocked so this file proves
// only the route's own wiring, not the service (see pms-time-service.test.ts
// for the approveTimeEntry state-machine/self-approval tests).
import { describe, test, expect, mock } from "bun:test"

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }
  const userRank = RANK[user?.role] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function makeRequest(): Request {
  return new Request("http://localhost/api/pms/time-entries/entry-1/approve", { method: "POST" })
}

describe("POST /api/pms/time-entries/[id]/approve (access control)", () => {
  test("a member (designer rank, below manager) is rejected with 403 and approveTimeEntry is never called", async () => {
    const approveTimeEntry = mock(async () => { throw new Error("approveTimeEntry should not be called for a non-manager") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-time-service", () => ({ approveTimeEntry }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: class extends Error { status = 400 },
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "entry-1" }) })
    expect(res.status).toBe(403)
    expect(approveTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank user is allowed through and approveTimeEntry is called", async () => {
    const approveTimeEntry = mock(async () => ({ id: "entry-1", approvalStatus: "approved" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-time-service", () => ({ approveTimeEntry }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: class extends Error { status = 400 },
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "entry-1" }) })
    expect(res.status).toBe(200)
    expect(approveTimeEntry).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
