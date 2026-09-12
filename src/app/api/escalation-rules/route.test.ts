/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST /api/escalation-rules had NO
// role gate at all. Fixed to require "admin", matching this same helpdesk
// module's own sibling config resource, /api/sla-policies (POST/PATCH both
// require "admin") -- the escalation chain this rule adds to is the exact
// table checkTicketEscalations() (the escalation cron) fires against, keyed
// off slaPolicyId.
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
  return new Request("http://localhost/api/escalation-rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/escalation-rules (access control)", () => {
  test("a manager (below admin) is rejected with 403 and the service is never called", async () => {
    const createEscalationRule = mock(async () => { throw new Error("createEscalationRule should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listEscalationRules: mock(async () => []),
      createEscalationRule,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ slaPolicyId: "sla-1", thresholdMinutes: 30 }) as any)
    expect(res.status).toBe(403)
    expect(createEscalationRule).not.toHaveBeenCalled()
    mock.restore()
  })

  test("an admin-rank user passes the role gate and the service is called", async () => {
    const createEscalationRule = mock(async () => ({ id: "rule-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ticket-service", () => ({
      listEscalationRules: mock(async () => []),
      createEscalationRule,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ slaPolicyId: "sla-1", thresholdMinutes: 30 }) as any)
    expect(res.status).not.toBe(403)
    expect(createEscalationRule).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
