/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST /api/drafted-communications
// had NO role gate at all. Fixed to require "member" -- drafting only
// creates a pending_approval row, it never sends anything (send only
// happens via approveCommunication, already gated at "senior_professional"
// on ./[id]/approve/route.ts) -- matching this codebase's own
// "draft/create = member, approve/finalize = higher" pattern.
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
  return new Request("http://localhost/api/drafted-communications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/drafted-communications (access control)", () => {
  test("a viewer (below member) is rejected with 403 and the service is never called", async () => {
    const draftCommunication = mock(async () => { throw new Error("draftCommunication should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/communication-drafting-service", () => ({
      listDraftedCommunications: mock(async () => []),
      draftCommunication,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ communicationType: "email", triggerType: "manual", recipientEmails: ["a@b.com"], context: "hi" }) as any)
    expect(res.status).toBe(403)
    expect(draftCommunication).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and the service is called", async () => {
    const draftCommunication = mock(async () => ({ id: "draft-1", status: "pending_approval" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/communication-drafting-service", () => ({
      listDraftedCommunications: mock(async () => []),
      draftCommunication,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ communicationType: "email", triggerType: "manual", recipientEmails: ["a@b.com"], context: "hi" }) as any)
    expect(res.status).not.toBe(403)
    expect(draftCommunication).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
