/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). construction-kpi-service.ts's
// own header comment documents "submit is the 'member' rank, approve
// requires 'manager'+ (enforced at the route layer via requireRole)" -- but
// this route never actually enforced it. Fixed to require "member", matching
// the documented intent and construction/kpi-entries/route.ts's own POST gate.
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
  return new Request("http://localhost/api/construction/kpi-definitions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/construction/kpi-definitions (access control)", () => {
  test("a viewer (below member) is rejected with 403 and createKpiDefinition is never called", async () => {
    const createKpiDefinition = mock(async () => { throw new Error("createKpiDefinition should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/construction-kpi-service", () => ({
      createKpiDefinition,
      listKpiDefinitions: mock(async () => []),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ metricName: "Concrete Poured" }) as any)
    expect(res.status).toBe(403)
    expect(createKpiDefinition).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and createKpiDefinition is called", async () => {
    const createKpiDefinition = mock(async () => ({ id: "kpi-1", metricName: "Concrete Poured" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/construction-kpi-service", () => ({
      createKpiDefinition,
      listKpiDefinitions: mock(async () => []),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ metricName: "Concrete Poured" }) as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(201)
    expect(createKpiDefinition).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
