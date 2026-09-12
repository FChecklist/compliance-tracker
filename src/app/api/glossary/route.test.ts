/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST /api/glossary had NO role
// gate at all -- any authenticated org member could add to this org-wide
// reference-data picklist. Fixed to require "manager", the same
// "master-data configuration = manager" bar as this codebase's own sibling
// org-wide picklist gates (crm.pipeline_stages.manage, crm.lost_reasons.manage).
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
  return new Request("http://localhost/api/glossary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/glossary (access control)", () => {
  test("a member (below manager) is rejected with 403 and the service is never called", async () => {
    const createGlossaryTerm = mock(async () => { throw new Error("createGlossaryTerm should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/glossary-service", () => ({
      listGlossaryTerms: mock(async () => []),
      createGlossaryTerm,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ term: "KYC", definition: "Know Your Customer" }) as any)
    expect(res.status).toBe(403)
    expect(createGlossaryTerm).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank user passes the role gate and the service is called", async () => {
    const createGlossaryTerm = mock(async () => ({ id: "term-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/glossary-service", () => ({
      listGlossaryTerms: mock(async () => []),
      createGlossaryTerm,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ term: "KYC", definition: "Know Your Customer" }) as any)
    expect(res.status).not.toBe(403)
    expect(createGlossaryTerm).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
