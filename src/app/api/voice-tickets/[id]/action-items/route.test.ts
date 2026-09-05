/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "member")
// gate added to POST /api/voice-tickets/[id]/action-items -- see the route's
// own comment for why "member" was chosen (mirrors
// /api/veri-meetings/[id]/action-items's own gate exactly, and matches this
// service's own sibling, POST /api/voice-tickets's memo-upload "member" gate).
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
  return new Request("http://localhost/api/voice-tickets/memo-1/action-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/voice-tickets/[id]/action-items (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and addVoiceMemoTicket is never called", async () => {
    const addVoiceMemoTicket = mock(async () => { throw new Error("addVoiceMemoTicket should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/voice-ticket-service", () => ({
      addVoiceMemoTicket,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ title: "Order parts" }) as any, { params: Promise.resolve({ id: "memo-1" }) })
    expect(res.status).toBe(403)
    expect(addVoiceMemoTicket).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank caller passes the role gate and the action item is added", async () => {
    const addVoiceMemoTicket = mock(async () => ({ id: "ai-1", voiceMemoId: "memo-1", task: { id: "task-1", title: "Order parts" } }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/voice-ticket-service", () => ({
      addVoiceMemoTicket,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ title: "Order parts" }) as any, { params: Promise.resolve({ id: "memo-1" }) })
    expect(res.status).toBe(201)
    expect(addVoiceMemoTicket).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
