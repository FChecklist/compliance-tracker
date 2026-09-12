/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G6 pms gap-closure). POST /api/pms/issues/[id]/relations
// had NO role gate at all -- any authenticated org member could link one
// issue to another (blocks/blocked_by/duplicates/relates_to). Fixed to
// require "member", matching this exact resource's own already-gated
// siblings in pms-issue-service.ts: POST /api/pms/issues (createIssue) and
// PATCH /api/pms/issues/[id] (updateIssue) are both member-gated -- adding a
// relation is an edit of the same issue resource, at the same granularity.
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
  return new Request("http://localhost/api/pms/issues/issue-1/relations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: "issue-1" })

describe("POST /api/pms/issues/[id]/relations (access control)", () => {
  test("a viewer (below member) is rejected with 403 and addIssueRelation is never called", async () => {
    const addIssueRelation = mock(async () => { throw new Error("addIssueRelation should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-issue-service", () => ({
      listIssueRelations: mock(async () => []),
      addIssueRelation,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ relatedIssueId: "issue-2", relationType: "blocks" }) as any, { params } as any)
    expect(res.status).toBe(403)
    expect(addIssueRelation).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and addIssueRelation is called", async () => {
    const addIssueRelation = mock(async () => ({ id: "relation-1", issueId: "issue-1", relatedIssueId: "issue-2", relationType: "blocks" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-issue-service", () => ({
      listIssueRelations: mock(async () => []),
      addIssueRelation,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ relatedIssueId: "issue-2", relationType: "blocks" }) as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(addIssueRelation).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
