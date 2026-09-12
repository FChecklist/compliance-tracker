/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRole(dbUser, "manager")
// gate added to POST /api/metric-alert-rules -- this route previously had no
// role check at all beyond a real session. Mocks @/lib/supabase/auth-guard
// and @/lib/services/metric-alert-service (same convention as
// src/app/api/pms/time-entries/[id]/approve/route.test.ts), so this proves
// only the route's own wiring: a below-minimum-role caller is rejected with
// the gate's own 403 before createMetricAlertRule() is ever called, and an
// at-minimum-role caller reaches it.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makeRequest(): Request {
  return new Request("http://localhost/api/metric-alert-rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Rule", sourceEntity: "tasks", threshold: 5, notifyUserIds: ["user-2"] }),
  })
}

// mock.module() replaces the WHOLE module for the whole test process (see
// src/app/api/me/route.test.ts's own header) -- the sibling [id]/route.test.ts
// imports updateMetricAlertRule/deleteMetricAlertRule from this same module,
// so spreading the real module first (rather than a bare object literal)
// keeps those exports intact regardless of file/test run order.
async function mockService(createMetricAlertRule: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/metric-alert-service")
  mock.module("@/lib/services/metric-alert-service", () => ({ ...actual, createMetricAlertRule }))
}

describe("POST /api/metric-alert-rules (access control)", () => {
  test("a role below manager (member) is rejected with 403 and createMetricAlertRule is never called", async () => {
    const createMetricAlertRule = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createMetricAlertRule)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createMetricAlertRule).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and createMetricAlertRule is called", async () => {
    const createMetricAlertRule = mock(async () => ({ id: "rule-1", name: "Rule" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createMetricAlertRule)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(createMetricAlertRule).toHaveBeenCalledTimes(1)
  })
})
