/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "admin") gate
// added to POST /api/ticket-teams -- see the route's own comment for why
// "admin" (matched to this same helpdesk admin-CRUD module's own siblings,
// /api/sla-policies and /api/escalation-rules, both "admin" -- not the lower
// "manager" bar /api/business-hours-schedules uses, since a ticket team's
// leadUserId is auto-added as a conversation participant on every ticket
// routed to it, a real access-control side effect the other two config
// resources don't carry).
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
  return new Request("http://localhost/api/ticket-teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/ticket-teams (access control)", () => {
  test("a role below admin (manager) is rejected with 403 and createTicketTeam is never called", async () => {
    const createTicketTeam = mock(async () => { throw new Error("createTicketTeam should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listTicketTeams: mock(async () => []),
      createTicketTeam,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Support" }) as any)
    expect(res.status).toBe(403)
    expect(createTicketTeam).not.toHaveBeenCalled()
    mock.restore()
  })

  test("an admin-rank caller passes the role gate and the team is created", async () => {
    const createTicketTeam = mock(async () => ({ id: "team-1", name: "Support" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listTicketTeams: mock(async () => []),
      createTicketTeam,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ name: "Support" }) as any)
    expect(res.status).toBe(201)
    expect(createTicketTeam).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
