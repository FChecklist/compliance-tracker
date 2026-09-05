/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "member")
// gate added to POST /api/search/semantic -- see the route's own comment for
// why "member" was chosen (read-only over data the org's real staff already
// have access to, but excludes the rank-1 restricted-view tiers
// viewer/client_viewer/external_auditor/stage_0).
// @/lib/embeddings and @/lib/db/tenant-scoped are mocked (@/lib/db's own
// schema-table imports are left real and unmocked, same convention as
// departments/route.test.ts -- lazy connection, safe to import without a
// live DB) so this exercises only the route's own role gate, never a live DB.
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/search/semantic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function mockNonAuthModules(findSimilarImpl: () => Promise<any[]>) {
  mock.module("@/lib/embeddings", () => ({
    findSimilar: mock(findSimilarImpl),
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: any) => any) => fn({ query: {} })),
  }))
}

describe("POST /api/search/semantic (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and findSimilar is never called", async () => {
    const findSimilar = mock(async () => { throw new Error("findSimilar should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mockNonAuthModules(findSimilar)

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ query: "gst notice" }) as any)
    expect(res.status).toBe(403)
    expect(findSimilar).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank caller passes the role gate and the search runs", async () => {
    const findSimilar = mock(async () => [])
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mockNonAuthModules(findSimilar)

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ query: "gst notice" }) as any)
    expect(res.status).toBe(200)
    expect(findSimilar).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
