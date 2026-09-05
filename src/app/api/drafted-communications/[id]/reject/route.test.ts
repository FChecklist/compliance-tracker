/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST
// /api/drafted-communications/[id]/reject had NO role gate at all, while its
// own sibling decision, ../approve/route.ts, already requires
// "senior_professional". Fixed to match approve's own bar -- reject is the
// symmetric decision endpoint on the same pending_approval resource.
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
  return new Request("http://localhost/api/drafted-communications/draft-1/reject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: "draft-1" })

describe("POST /api/drafted-communications/[id]/reject (access control)", () => {
  test("a member (below senior_professional) is rejected with 403 and the service is never called", async () => {
    const rejectCommunication = mock(async () => { throw new Error("rejectCommunication should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/communication-drafting-service", () => ({
      rejectCommunication,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ reason: "not needed" }) as any, { params } as any)
    expect(res.status).toBe(403)
    expect(rejectCommunication).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a senior_professional-rank user passes the role gate and the service is called", async () => {
    const rejectCommunication = mock(async () => ({ id: "draft-1", status: "rejected" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("senior_professional"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/communication-drafting-service", () => ({
      rejectCommunication,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ reason: "not needed" }) as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(rejectCommunication).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
