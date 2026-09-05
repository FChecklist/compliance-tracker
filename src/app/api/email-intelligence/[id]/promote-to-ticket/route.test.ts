/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G3-email-conv): proves the requireRole(dbUser,
// "team_member") gate added to POST
// /api/email-intelligence/[id]/promote-to-ticket -- see the route's own
// comment for why "team_member" was chosen (matches POST /api/tickets's
// requireRole(dbUser, "team_member"), since this action calls the exact
// same createTicket() a direct ticket-creation call does).
// @/lib/services/ticket-service is mocked entirely so this test never
// reaches a real DB.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1,
  member: 2, team_member: 2, senior_professional: 3, manager: 3,
  branch_manager: 4, admin: 5, veridian_admin: 6,
}

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1", name: "Test User" } as any
}

function makeRequest(): Request {
  return new Request("http://localhost/api/email-intelligence/eii-1/promote-to-ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
}

function fakeServiceError() {
  return class ServiceError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } }
}

describe("POST /api/email-intelligence/[id]/promote-to-ticket (access control)", () => {
  test("a role below team_member (viewer) is rejected with 403 and createTicketFromEmailIntelligenceItem is never called", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      createTicketFromEmailIntelligenceItem: mock(async () => { throw new Error("createTicketFromEmailIntelligenceItem should not be reached for a below-minimum role") }),
      ServiceError: fakeServiceError(),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "eii-1" }) })
    expect(res.status).toBe(403)
  })

  test("a team_member-rank caller is allowed through and a ticket is created", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("team_member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      createTicketFromEmailIntelligenceItem: mock(async () => ({ id: "ticket-1", subject: "Invoice due" })),
      ServiceError: fakeServiceError(),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "eii-1" }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("ticket-1")
  })
})
