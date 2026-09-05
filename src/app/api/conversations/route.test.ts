/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G3-email-conv): proves the requireRole(dbUser,
// "member") gate added to POST /api/conversations -- see the route's own
// comment for why "member" was chosen (matches POST /api/documents and
// POST /api/tasks's floor for creating a new org object). GET is untouched
// (no gap was filed for it) so it is not tested here.
// @/lib/services/chat-service is mocked entirely so this test never reaches
// a real DB -- createConversation is a bare mock that fails fast on the
// reject case (proving the gate runs BEFORE it) and returns a canned result
// on the permit case.
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
  return new Request("http://localhost/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantUserIds: ["user-2"], title: "Hello" }),
  })
}

describe("POST /api/conversations (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and createConversation is never called", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/chat-service", () => ({
      createConversation: mock(async () => { throw new Error("createConversation should not be reached for a below-minimum role") }),
      listConversations: mock(async () => ({ conversations: [] })),
      ServiceError: class ServiceError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } },
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
  })

  test("a member-rank caller is allowed through and the conversation is created", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/chat-service", () => ({
      createConversation: mock(async () => ({ id: "convo-1", type: "direct", title: "Hello", createdAt: new Date().toISOString(), dynamicChainId: null })),
      listConversations: mock(async () => ({ conversations: [] })),
      ServiceError: class ServiceError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } },
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("convo-1")
  })
})
