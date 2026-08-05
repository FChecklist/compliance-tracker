/// <reference types="bun-types" />
// Regression test for a real gap found via OCID-047's independent live
// re-verification (UMR-20260805-002929-5560, UMR-20260802-165606-4413):
// POST /api/users used a hardcoded `role === 'admin' || role === 'manager'`
// string check instead of requireRole()/ROLE_RANK, so veridian_admin
// (rank 6), branch_manager (rank 4), and senior_professional (rank 3, same
// rank as manager) were all live-confirmed to get rejected with 403 trying
// to invite a user -- an action rank-3 manager can do. Same isolation
// pattern as settings/branding/route.test.ts: @/lib/supabase/auth-guard is
// mocked so this only proves the route's own access-control wiring, no
// live DB or real Supabase Auth needed. @/lib/org-license-service is
// mocked to fail fast with a distinct marker reason right after the role
// gate, so a "passes the role gate" case can be proven without needing to
// mock the full downstream invite flow (db insert / Supabase admin
// inviteUserByEmail / bcrypt / AI-assistant provisioning).
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2,
  senior_professional: 3, manager: 3,
  branch_manager: 4,
  admin: 5,
  veridian_admin: 6,
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const userRank = RANK[user?.role] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function makeRequest(): Request {
  return new Request("http://localhost/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "newuser@veridian-test.internal", role: "member" }),
  })
}

function mockAuthGuard(role: string) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(role), orgId: "org-1" })),
    requireRole: fakeRequireRole,
  }))
}

describe("POST /api/users (access control -- OCID-047 regression)", () => {
  test("a viewer (below manager) is rejected with 403", async () => {
    mockAuthGuard("viewer")
    mock.module("@/lib/org-license-service", () => ({
      canAssignSeat: mock(async () => { throw new Error("canAssignSeat should not be reached for a rejected role") }),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("This action requires manager role or higher")
  })

  test("a member (below manager) is rejected with 403", async () => {
    mockAuthGuard("member")
    mock.module("@/lib/org-license-service", () => ({
      canAssignSeat: mock(async () => { throw new Error("canAssignSeat should not be reached for a rejected role") }),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
  })

  test("manager passes the role gate (baseline, was already correct)", async () => {
    mockAuthGuard("manager")
    mock.module("@/lib/org-license-service", () => ({
      canAssignSeat: mock(async () => ({ allowed: false, reason: "PAST-ROLE-GATE-MARKER" })),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("PAST-ROLE-GATE-MARKER")
  })

  test("REGRESSION: senior_professional (rank 3, same as manager) now passes the role gate", async () => {
    mockAuthGuard("senior_professional")
    mock.module("@/lib/org-license-service", () => ({
      canAssignSeat: mock(async () => ({ allowed: false, reason: "PAST-ROLE-GATE-MARKER" })),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    const body = await res.json()
    expect(body.error).toBe("PAST-ROLE-GATE-MARKER")
  })

  test("REGRESSION: branch_manager (rank 4) now passes the role gate", async () => {
    mockAuthGuard("branch_manager")
    mock.module("@/lib/org-license-service", () => ({
      canAssignSeat: mock(async () => ({ allowed: false, reason: "PAST-ROLE-GATE-MARKER" })),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    const body = await res.json()
    expect(body.error).toBe("PAST-ROLE-GATE-MARKER")
  })

  test("REGRESSION: veridian_admin (rank 6, highest) now passes the role gate", async () => {
    mockAuthGuard("veridian_admin")
    mock.module("@/lib/org-license-service", () => ({
      canAssignSeat: mock(async () => ({ allowed: false, reason: "PAST-ROLE-GATE-MARKER" })),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    const body = await res.json()
    expect(body.error).toBe("PAST-ROLE-GATE-MARKER")
  })

  test("admin passes the role gate (baseline, was already correct)", async () => {
    mockAuthGuard("admin")
    mock.module("@/lib/org-license-service", () => ({
      canAssignSeat: mock(async () => ({ allowed: false, reason: "PAST-ROLE-GATE-MARKER" })),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    const body = await res.json()
    expect(body.error).toBe("PAST-ROLE-GATE-MARKER")
  })
})
