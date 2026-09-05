/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "member") gate
// added to POST /api/problem-records/[id]/tickets -- see the route's own
// comment for why "member" was chosen (matched to POST /api/problem-records'
// own bar in ticket-service.ts, not the higher "manager" bar PATCH
// /api/problem-records/[id] uses for RCA-closure status changes).
// @/lib/services/ticket-service is mocked with just the exports this route
// imports (listTicketsForProblem/linkTicketToProblem/ServiceError), matching
// this file's own established convention for that specifier (see
// escalation-rules/route.test.ts, which mocks the same module with a
// different, equally narrow subset).
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
  return new Request("http://localhost/api/problem-records/problem-1/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/problem-records/[id]/tickets (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and linkTicketToProblem is never called", async () => {
    const linkTicketToProblem = mock(async () => { throw new Error("linkTicketToProblem should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listTicketsForProblem: mock(async () => []),
      linkTicketToProblem,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ ticketId: "ticket-1" }) as any, { params: Promise.resolve({ id: "problem-1" }) })
    expect(res.status).toBe(403)
    expect(linkTicketToProblem).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank caller passes the role gate and the ticket is linked", async () => {
    const linkTicketToProblem = mock(async () => ({ id: "link-1", problemId: "problem-1", ticketId: "ticket-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listTicketsForProblem: mock(async () => []),
      linkTicketToProblem,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ ticketId: "ticket-1" }) as any, { params: Promise.resolve({ id: "problem-1" }) })
    expect(res.status).toBe(201)
    expect(linkTicketToProblem).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
