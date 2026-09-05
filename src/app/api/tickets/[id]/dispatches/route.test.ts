/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "team_member")
// gate added to POST /api/tickets/[id]/dispatches -- see the route's own
// comment for why "team_member" was chosen (matched to /api/tickets/[id]'s
// own PATCH floor and to PATCH /api/field-service-dispatches/[dispatchId]'s
// already-established "team_member" gate on this exact sub-resource).
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
  return new Request("http://localhost/api/tickets/ticket-1/dispatches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/tickets/[id]/dispatches (access control)", () => {
  test("a role below team_member (viewer) is rejected with 403 and createFieldServiceDispatch is never called", async () => {
    const createFieldServiceDispatch = mock(async () => { throw new Error("createFieldServiceDispatch should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listFieldServiceDispatches: mock(async () => []),
      createFieldServiceDispatch,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ scheduledAt: "2026-09-10T10:00:00.000Z" }) as any, { params: Promise.resolve({ id: "ticket-1" }) })
    expect(res.status).toBe(403)
    expect(createFieldServiceDispatch).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a team_member-rank caller passes the role gate and the dispatch is created", async () => {
    const createFieldServiceDispatch = mock(async () => ({ id: "dispatch-1", ticketId: "ticket-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("team_member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listFieldServiceDispatches: mock(async () => []),
      createFieldServiceDispatch,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ scheduledAt: "2026-09-10T10:00:00.000Z" }) as any, { params: Promise.resolve({ id: "ticket-1" }) })
    expect(res.status).toBe(201)
    expect(createFieldServiceDispatch).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
