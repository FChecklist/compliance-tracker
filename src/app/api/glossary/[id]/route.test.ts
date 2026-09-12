/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). PATCH and DELETE
// /api/glossary/[id] had NO role gate at all. Fixed to require "manager",
// same gate as POST /api/glossary -- see that file's own test/comment.
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

function makeRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/glossary/term-1", {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: "term-1" })

describe("PATCH /api/glossary/[id] (access control)", () => {
  test("a member (below manager) is rejected with 403 and the service is never called", async () => {
    const updateGlossaryTerm = mock(async () => { throw new Error("updateGlossaryTerm should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/glossary-service", () => ({
      updateGlossaryTerm,
      deleteGlossaryTerm: mock(async () => { throw new Error("should not be called") }),
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH", { definition: "updated" }) as any, { params } as any)
    expect(res.status).toBe(403)
    expect(updateGlossaryTerm).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank user passes the role gate and the service is called", async () => {
    const updateGlossaryTerm = mock(async () => ({ id: "term-1", definition: "updated" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/glossary-service", () => ({
      updateGlossaryTerm,
      deleteGlossaryTerm: mock(async () => { throw new Error("should not be called") }),
      ServiceError: FakeServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(makeRequest("PATCH", { definition: "updated" }) as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(updateGlossaryTerm).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})

describe("DELETE /api/glossary/[id] (access control)", () => {
  test("a member (below manager) is rejected with 403 and the service is never called", async () => {
    const deleteGlossaryTerm = mock(async () => { throw new Error("deleteGlossaryTerm should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/glossary-service", () => ({
      updateGlossaryTerm: mock(async () => { throw new Error("should not be called") }),
      deleteGlossaryTerm,
      ServiceError: FakeServiceError,
    }))

    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params } as any)
    expect(res.status).toBe(403)
    expect(deleteGlossaryTerm).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank user passes the role gate and the service is called", async () => {
    const deleteGlossaryTerm = mock(async () => ({ success: true }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/glossary-service", () => ({
      updateGlossaryTerm: mock(async () => { throw new Error("should not be called") }),
      deleteGlossaryTerm,
      ServiceError: FakeServiceError,
    }))

    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest("DELETE") as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(deleteGlossaryTerm).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
