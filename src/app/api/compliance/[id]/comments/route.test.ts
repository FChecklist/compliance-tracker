/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). This route previously had
// no role floor at all -- any authenticated org member (including a
// viewer/stage_0/client_viewer/external_auditor-rank account) could comment
// on any compliance item in the org. Fixed to require "member", matching
// the sibling compliance/[id]/costs POST gate (see that route's own
// requireRole(dbUser, "member") call).
//
// Same convention as src/app/api/pms/time-entries/[id]/approve/route.test.ts:
// mock @/lib/supabase/auth-guard's requireRole with a real-rank-table
// reimplementation (imported from the leaf ./role-rank module, not a second
// hand-copied table) so the test exercises the ROUTE's own wiring -- does it
// actually call requireRole() -- not a mocked-away no-op.
import { describe, test, expect, mock } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1", name: "Test User", email: "test@example.com", avatarUrl: null } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const userRank = ROLE_RANK[user?.role as keyof typeof ROLE_RANK] ?? 0
  const requiredRank = ROLE_RANK[minimumRole as keyof typeof ROLE_RANK] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function makeRequest(content: string): Request {
  return new Request("http://localhost/api/compliance/item-1/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  })
}

function makeContext() {
  return { params: Promise.resolve({ id: "item-1" }) }
}

describe("POST /api/compliance/[id]/comments (access control)", () => {
  test("a viewer (below member, the only rank under it) is rejected with 403 and the DB is never touched", async () => {
    const withTenantContext = mock(async () => { throw new Error("withTenantContext should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest("hello") as any, makeContext() as any)
    expect(res.status).toBe(403)
    expect(withTenantContext).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate (reaches the DB, not blocked with 403)", async () => {
    const withTenantContext = mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      fn({
        query: {
          complianceItems: {
            // Item not found is a legitimate, unrelated 404 -- what matters
            // here is that the gate let the call reach the DB at all.
            findFirst: async () => null,
          },
        },
      })
    )
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest("hello") as any, makeContext() as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(404) // "Compliance item not found" -- an unrelated failure, not the role gate
    expect(withTenantContext).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
