/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). submitCodeChangeRequest()
// writes into the maker-checker approval pipeline (approvalRequests +
// codeChangeRequests) and previously had no role floor beyond generic auth.
// Fixed to require "member", the baseline write-action floor used elsewhere
// in this codebase (e.g. business-rules/route.ts's create,
// construction/progress/route.ts's create).
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
  return new Request("http://localhost/api/code-change-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/code-change-requests (access control)", () => {
  test("a viewer (below member) is rejected with 403 and submitCodeChangeRequest is never called", async () => {
    const submitCodeChangeRequest = mock(async () => { throw new Error("should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/code-change-request-service", () => ({
      submitCodeChangeRequest,
      listCodeChangeRequests: mock(async () => ({ requests: [] })),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ originatingLayer: "personal", requestedChange: "fix the thing" }) as any)
    expect(res.status).toBe(403)
    expect(submitCodeChangeRequest).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and submitCodeChangeRequest is called", async () => {
    const submitCodeChangeRequest = mock(async () => ({ id: "ccr-1", status: "pending" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/code-change-request-service", () => ({
      submitCodeChangeRequest,
      listCodeChangeRequests: mock(async () => ({ requests: [] })),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ originatingLayer: "personal", requestedChange: "fix the thing" }) as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(201)
    expect(submitCodeChangeRequest).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
