/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G6 pms gap-closure). PATCH /api/pms/wiki/[id] had NO
// role gate at all -- any authenticated org member could edit any project
// wiki page. Fixed to require "member", same bar as POST /api/pms/wiki (see
// that file's own test/comment) -- knowledge-base-service.ts's sibling
// PATCH /api/knowledge-base/pages/[id] is also gated at "member".
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
  return new Request("http://localhost/api/pms/wiki/page-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: "page-1" })

describe("PATCH /api/pms/wiki/[id] (access control)", () => {
  test("a viewer (below member) is rejected with 403 and updateWikiPage is never called", async () => {
    const updateWikiPage = mock(async () => { throw new Error("updateWikiPage should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-wiki-service", () => ({ updateWikiPage }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ title: "Updated" }) as any, { params } as any)
    expect(res.status).toBe(403)
    expect(updateWikiPage).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and updateWikiPage is called", async () => {
    const updateWikiPage = mock(async () => ({ id: "page-1", title: "Updated" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-wiki-service", () => ({ updateWikiPage }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest({ title: "Updated" }) as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(updateWikiPage).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
