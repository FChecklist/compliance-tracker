/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). This route writes an
// audit-log row (and can trigger an anomaly escalation) and previously had
// no role floor at all beyond generic auth. Fixed to require "member",
// matching compliance/route.ts's own POST floor and the sibling
// compliance/[id]/costs POST gate.
//
// Same convention as src/app/api/pms/time-entries/[id]/approve/route.test.ts:
// requireRole is mocked with a reimplementation over the REAL ROLE_RANK
// table (imported from the leaf ./role-rank module) so this test exercises
// whether route.ts itself calls the gate, not a hand-copied duplicate.
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/compliance/export-event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/compliance/export-event (access control)", () => {
  test("a viewer (below member) is rejected with 403 and no audit/anomaly write happens", async () => {
    const withTenantContext = mock(async () => { throw new Error("withTenantContext should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ count: 42 }) as any)
    expect(res.status).toBe(403)
    expect(withTenantContext).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and the export event is logged", async () => {
    const withTenantContext = mock(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn({}))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
    mock.module("@/lib/audit", () => ({ logActivity: mock(async () => {}) }))
    mock.module("@/lib/risk-anomaly-detection", () => ({ evaluateBulkExportAnomaly: mock(() => ({ anomaly: false })) }))
    mock.module("@/lib/services/risk-escalation-service", () => ({ recordAndEscalateAnomaly: mock(async () => {}) }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ count: 42 }) as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
    expect(withTenantContext).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
