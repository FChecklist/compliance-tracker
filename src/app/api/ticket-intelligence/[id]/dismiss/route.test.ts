/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser,
// "senior_professional") gate added to POST /api/ticket-intelligence/[id]/dismiss
// -- see the route's own comment for why "senior_professional" was chosen
// (matched to its own sibling ../promote/route.ts's already-established bar
// for this service, not email-intelligence's lower "member" bar for the
// same-shaped dismiss/promote pair -- ticket-intelligence sets its own floor).
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
  return new Request("http://localhost/api/ticket-intelligence/tii-1/dismiss", { method: "POST" })
}

describe("POST /api/ticket-intelligence/[id]/dismiss (access control)", () => {
  test("a role below senior_professional (member) is rejected with 403 and dismissTicketIntelligenceItem is never called", async () => {
    const dismissTicketIntelligenceItem = mock(async () => { throw new Error("dismissTicketIntelligenceItem should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-intelligence-service", () => ({
      dismissTicketIntelligenceItem,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "tii-1" }) })
    expect(res.status).toBe(403)
    expect(dismissTicketIntelligenceItem).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a senior_professional-rank caller passes the role gate and the item is dismissed", async () => {
    const dismissTicketIntelligenceItem = mock(async () => ({ id: "tii-1", status: "dismissed" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("senior_professional"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-intelligence-service", () => ({
      dismissTicketIntelligenceItem,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "tii-1" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("dismissed")
    expect(dismissTicketIntelligenceItem).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
