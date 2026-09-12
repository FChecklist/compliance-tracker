/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRole(dbUser, "member")
// gate added to POST /api/social/posts -- this route previously had no role
// check at all. Mocks @/lib/supabase/auth-guard and
// @/lib/services/social-feed-service (real module spread first, since the
// sibling [id]/comments and [id]/reactions route.test.ts files mock the
// same module -- mock.module() replaces the whole module for the whole test
// process, see src/app/api/me/route.test.ts's own header), so this proves
// only the route's own wiring.
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
  return new Request("http://localhost/api/social/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "hello team" }),
  })
}

async function mockService(createPost: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/social-feed-service")
  mock.module("@/lib/services/social-feed-service", () => ({ ...actual, createPost }))
}

describe("POST /api/social/posts (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and createPost is never called", async () => {
    const createPost = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createPost)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createPost).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and createPost is called", async () => {
    const createPost = mock(async () => ({ id: "post-1", content: "hello team" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createPost)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(createPost).toHaveBeenCalledTimes(1)
  })
})
