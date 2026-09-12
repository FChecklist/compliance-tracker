/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRole(dbUser, "member")
// gate added to POST /api/tasks/[id]/chat -- any authenticated org member of
// any role could previously post to ANY task's chat thread. This is a role
// gate only (not an ownership check -- see the route's own comment on why).
// @/lib/db/tenant-scoped is mocked to fail fast if ever reached (matching
// authz-gate-coverage.test.ts's own convention), so the reject-side assertion
// proves the gate runs BEFORE any DB access, and the permit-side supplies a
// real fake tx so the happy path can be asserted all the way through.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makeRequest(): Request {
  return new Request("http://localhost/api/tasks/task-1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "hello" }),
  })
}

describe("POST /api/tasks/[id]/chat (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and the DB is never touched", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async () => { throw new Error("withTenantContext should not be reached for a below-minimum role") }),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "task-1" }) })
    expect(res.status).toBe(403)
  })

  test("a member-rank caller is allowed through and the chat message is posted", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
        fn({
          query: { tasks: { findFirst: async () => ({ id: "task-1" }) } },
          insert: () => ({ values: () => ({ returning: async () => [{ id: "msg-1", role: "user", content: "hello", createdAt: new Date() }] }) }),
        })
      ),
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "task-1" }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.content).toBe("hello")
  })
})
