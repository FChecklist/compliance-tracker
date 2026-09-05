/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST /api/document-matching-rules
// had NO role gate at all -- any authenticated org member could add an
// auto-classification rule that tags future document uploads. Fixed to
// require "branch_manager", matching this exact resource's own sibling
// PATCH/DELETE (./[id]/route.ts).
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
  return new Request("http://localhost/api/document-matching-rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/document-matching-rules (access control)", () => {
  test("a member (below branch_manager) is rejected with 403 and the service is never called", async () => {
    const createMatchingRule = mock(async () => { throw new Error("createMatchingRule should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/document-classification-service", () => ({
      listMatchingRules: mock(async () => []),
      createMatchingRule,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ matchField: "filename", ruleType: "any_word", pattern: "invoice" }) as any)
    expect(res.status).toBe(403)
    expect(createMatchingRule).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a branch_manager-rank user passes the role gate and the service is called", async () => {
    const createMatchingRule = mock(async () => ({ id: "rule-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("branch_manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/document-classification-service", () => ({
      listMatchingRules: mock(async () => []),
      createMatchingRule,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ matchField: "filename", ruleType: "any_word", pattern: "invoice" }) as any)
    expect(res.status).not.toBe(403)
    expect(createMatchingRule).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
