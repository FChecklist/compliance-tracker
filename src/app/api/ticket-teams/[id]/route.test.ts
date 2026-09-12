/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "admin") gate
// added to PATCH /api/ticket-teams/[id] -- see the route's own comment (and
// ../route.ts's) for why "admin" was chosen.
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ticket-teams/team-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/ticket-teams/[id] (access control)", () => {
  test("a role below admin (manager) is rejected with 403 and updateTicketTeam is never called", async () => {
    const updateTicketTeam = mock(async () => { throw new Error("updateTicketTeam should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      updateTicketTeam,
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ name: "New name" }) as any, { params: Promise.resolve({ id: "team-1" }) })
    expect(res.status).toBe(403)
    expect(updateTicketTeam).not.toHaveBeenCalled()
    mock.restore()
  })

  test("an admin-rank caller passes the role gate and the team is updated", async () => {
    const updateTicketTeam = mock(async () => ({ id: "team-1", name: "New name" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      updateTicketTeam,
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ name: "New name" }) as any, { params: Promise.resolve({ id: "team-1" }) })
    expect(res.status).toBe(200)
    expect(updateTicketTeam).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
