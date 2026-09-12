/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G3-email-conv): proves the requireRole(dbUser,
// "member") gate added to POST /api/email-intelligence/[id]/promote -- see
// the route's own comment for why "member" was chosen (matches POST
// /api/tasks's requireRoleOrScope(ctx, "member"), since this action creates
// exactly that kind of object).
// @/lib/services/email-intelligence-service is mocked entirely so this test
// never reaches a real DB. The mock includes every OTHER named export of
// that module (analyzeInboundEmail/listEmailIntelligenceItems/
// dismissEmailIntelligenceItem/sanitizeSuggestedWorkItems), even though this
// route only calls promoteEmailIntelligenceItem -- see ../../route.test.ts's
// own comment for why: this same specifier is mocked with a different
// subset by 3 sibling route.test.ts files, and Bun's mock.module() has a
// first-mock-wins caching quirk for a shared specifier across files run in
// the same process. A full, consistent export surface in every one of them
// avoids it.
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
  return new Request("http://localhost/api/email-intelligence/eii-1/promote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ suggestedIndex: 0 }),
  })
}

function fakeServiceError() {
  return class ServiceError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } }
}

describe("POST /api/email-intelligence/[id]/promote (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and promoteEmailIntelligenceItem is never called", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/email-intelligence-service", () => ({
      promoteEmailIntelligenceItem: mock(async () => { throw new Error("promoteEmailIntelligenceItem should not be reached for a below-minimum role") }),
      analyzeInboundEmail: mock(async () => { throw new Error("not under test in this file") }),
      listEmailIntelligenceItems: mock(async () => []),
      dismissEmailIntelligenceItem: mock(async () => { throw new Error("not under test in this file") }),
      sanitizeSuggestedWorkItems: mock(() => []),
      ServiceError: fakeServiceError(),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "eii-1" }) })
    expect(res.status).toBe(403)
  })

  test("a member-rank caller is allowed through and the item is promoted to a task", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/email-intelligence-service", () => ({
      promoteEmailIntelligenceItem: mock(async () => ({ id: "action-1", taskId: "task-1", task: { id: "task-1", title: "Follow up" } })),
      analyzeInboundEmail: mock(async () => { throw new Error("not under test in this file") }),
      listEmailIntelligenceItems: mock(async () => []),
      dismissEmailIntelligenceItem: mock(async () => { throw new Error("not under test in this file") }),
      sanitizeSuggestedWorkItems: mock(() => []),
      ServiceError: fakeServiceError(),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "eii-1" }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.taskId).toBe("task-1")
  })
})
