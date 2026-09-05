/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). PATCH
// /api/field-service-dispatches/[dispatchId] had NO role gate at all. Fixed
// to require "team_member", matching /api/tickets/[id]/route.ts's own PATCH
// floor -- a field-service dispatch is a ticket sub-resource of the same
// operational granularity.
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
  return new Request("http://localhost/api/field-service-dispatches/dispatch-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ dispatchId: "dispatch-1" })

describe("PATCH /api/field-service-dispatches/[dispatchId] (access control)", () => {
  test("a viewer (below team_member) is rejected with 403 and the service is never called", async () => {
    const updateFieldServiceDispatch = mock(async () => { throw new Error("updateFieldServiceDispatch should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      updateFieldServiceDispatch,
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ status: "completed" }) as any, { params } as any)
    expect(res.status).toBe(403)
    expect(updateFieldServiceDispatch).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a team_member-rank user passes the role gate and the service is called", async () => {
    const updateFieldServiceDispatch = mock(async () => ({ id: "dispatch-1", status: "completed" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("team_member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      updateFieldServiceDispatch,
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ status: "completed" }) as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(updateFieldServiceDispatch).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
