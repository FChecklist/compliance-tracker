/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST
// /api/erp/parties/[type]/[id]/addresses had NO role gate at all. Fixed to
// require "manager", matching this exact resource's own sibling DELETE
// (./[addressId]/route.ts).
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
  return new Request("http://localhost/api/erp/parties/customer/party-1/addresses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ type: "customer", id: "party-1" })

describe("POST /api/erp/parties/[type]/[id]/addresses (access control)", () => {
  test("a member (below manager) is rejected with 403 and the service is never called", async () => {
    const addAddress = mock(async () => { throw new Error("addAddress should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/erp-party-service", () => ({
      listAddresses: mock(async () => []),
      addAddress,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ line1: "1 Main St" }) as any, { params } as any)
    expect(res.status).toBe(403)
    expect(addAddress).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank user passes the role gate and the service is called", async () => {
    const addAddress = mock(async () => ({ id: "addr-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/erp-party-service", () => ({
      listAddresses: mock(async () => []),
      addAddress,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ line1: "1 Main St" }) as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(addAddress).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
