/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). This route runs a real AI
// vision diff between two drawing revisions -- tenant-scoping the documents
// lookup is not a role restriction, and this had no role floor at all.
// Fixed to require "member", matching construction/progress/route.ts's own
// POST floor.
//
// withTenantContext is mocked to throw immediately in the "member passes"
// case -- proving the role gate let the call reach the DB layer (an
// unrelated downstream failure, not the role gate) without needing to also
// stand up a fake Supabase Storage download + AI vision call.
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

function makeRequest(): Request {
  return new Request("http://localhost/api/construction/ai/diff-drawings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentIdA: "doc-a", documentIdB: "doc-b" }),
  })
}

function mockCommon(withTenantContextImpl: () => Promise<unknown>) {
  mock.module("@/lib/db", () => ({ documents: {} }))
  mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mock(withTenantContextImpl) }))
  mock.module("@supabase/supabase-js", () => ({
    createClient: mock(() => { throw new Error("createClient should not be reached in this test") }),
  }))
  mock.module("@/lib/services/construction-ai-service", () => ({
    diffDrawingRevisions: mock(async () => { throw new Error("diffDrawingRevisions should not be reached in this test") }),
    ServiceError: FakeServiceError,
  }))
}

describe("POST /api/construction/ai/diff-drawings (access control)", () => {
  test("a viewer (below member) is rejected with 403 and the DB is never touched", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    const withTenantContext = mock(async () => { throw new Error("withTenantContext should not be called for a below-role caller") })
    mockCommon(withTenantContext as any)

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(withTenantContext).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and reaches the tenant-scoped DB layer", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    const withTenantContext = mock(async () => { throw new Error("sentinel: reached the DB layer") })
    mockCommon(withTenantContext as any)

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(500) // the sentinel error, not the role gate
    expect(withTenantContext).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
