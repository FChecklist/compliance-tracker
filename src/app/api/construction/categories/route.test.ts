/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). createCategory() writes a
// new construction progress-tracking category and previously had no role
// floor at all. Fixed to require "member", matching
// construction/progress/route.ts's and construction/kpi-entries/route.ts's
// own POST floor (same service surface / same write weight).
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
  return new Request("http://localhost/api/construction/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/construction/categories (access control)", () => {
  test("a viewer (below member) is rejected with 403 and createCategory is never called", async () => {
    const createCategory = mock(async () => { throw new Error("createCategory should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/construction-progress-service", () => ({
      createCategory,
      listCategories: mock(async () => []),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", name: "Civil" }) as any)
    expect(res.status).toBe(403)
    expect(createCategory).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and createCategory is called", async () => {
    const createCategory = mock(async () => ({ id: "cat-1", name: "Civil" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/construction-progress-service", () => ({
      createCategory,
      listCategories: mock(async () => []),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", name: "Civil" }) as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(201)
    expect(createCategory).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
