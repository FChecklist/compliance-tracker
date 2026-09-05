/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "team_member")
// gate added to PATCH /api/tickets/[id]/installed-product -- see the route's
// own comment for why "team_member" was chosen (matched to /api/tickets/[id]'s
// own PATCH floor, since this sets a plain field on the same ticket record).
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
  return new Request("http://localhost/api/tickets/ticket-1/installed-product", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/tickets/[id]/installed-product (access control)", () => {
  test("a role below team_member (viewer) is rejected with 403 and setTicketInstalledProduct is never called", async () => {
    const setTicketInstalledProduct = mock(async () => { throw new Error("setTicketInstalledProduct should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      setTicketInstalledProduct,
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ installedProductId: "ip-1" }) as any, { params: Promise.resolve({ id: "ticket-1" }) })
    expect(res.status).toBe(403)
    expect(setTicketInstalledProduct).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a team_member-rank caller passes the role gate and the installed product is linked", async () => {
    const setTicketInstalledProduct = mock(async () => ({ id: "ticket-1", installedProductId: "ip-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("team_member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      setTicketInstalledProduct,
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ installedProductId: "ip-1" }) as any, { params: Promise.resolve({ id: "ticket-1" }) })
    expect(res.status).toBe(200)
    expect(setTicketInstalledProduct).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
