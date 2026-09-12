/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRole(dbUser, "member")
// gate added to POST /api/social/posts/[id]/comments -- same gap and same
// fix as the sibling POST /api/social/posts (see its own route.test.ts).
// GET is untouched (no gap was filed for it). Real social-feed-service
// module spread first so this file's mock doesn't clobber the sibling
// route.test.ts files' exports of the same module (mock.module() replaces
// the whole module for the whole test process).
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
  return new Request("http://localhost/api/social/posts/post-1/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "nice post" }),
  })
}

async function mockService(addPostComment: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/social-feed-service")
  mock.module("@/lib/services/social-feed-service", () => ({ ...actual, addPostComment }))
}

describe("POST /api/social/posts/[id]/comments (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and addPostComment is never called", async () => {
    const addPostComment = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(addPostComment)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "post-1" }) })
    expect(res.status).toBe(403)
    expect(addPostComment).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and addPostComment is called", async () => {
    const addPostComment = mock(async () => ({ id: "comment-1", content: "nice post" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(addPostComment)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "post-1" }) })
    expect(res.status).toBe(201)
    expect(addPostComment).toHaveBeenCalledTimes(1)
  })
})
