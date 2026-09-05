/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). This route runs a real,
// costly AI vision call estimating progress from a photo, then writes the
// result onto the document row (documents.metadata); tenant scoping alone
// is not a role restriction, and this route previously had no role floor at
// all. Fixed to require "member", matching construction/progress/route.ts's
// own POST floor.
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
  return new Request("http://localhost/api/construction/ai/estimate-progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/construction/ai/estimate-progress (access control)", () => {
  test("a viewer (below member) is rejected with 403 and the DB is never touched", async () => {
    const withTenantContext = mock(async () => { throw new Error("withTenantContext should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
    mock.module("@/lib/services/construction-ai-service", () => ({
      estimateProgressFromPhoto: mock(async () => { throw new Error("should not be called") }),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ documentId: "doc-1", activityName: "Foundation" }) as any)
    expect(res.status).toBe(403)
    expect(withTenantContext).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate (reaches body validation, not blocked with 403)", async () => {
    const withTenantContext = mock(async () => { throw new Error("withTenantContext should not be called for this malformed body") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
    mock.module("@/lib/services/construction-ai-service", () => ({
      estimateProgressFromPhoto: mock(async () => { throw new Error("should not be called") }),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    // Missing documentId/activityName -- fails the route's own body
    // validation AFTER the role gate, an unrelated 400, never reaching the DB.
    const res = await POST(makeRequest({}) as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(400)
    expect(withTenantContext).not.toHaveBeenCalled()
    mock.restore()
  })
})
