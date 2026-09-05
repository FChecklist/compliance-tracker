/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRole(dbUser, "manager")
// gate added to POST /api/reports/definitions -- this route previously had
// no role check at all beyond a real session. A report definition's
// executionConfig resolves against report-engine-service.ts's own
// TABLE_REGISTRY (28+ tables spanning ERP financials, CRM, construction) --
// the same registry custom-charts/route.ts's manager-gated POST resolves
// against. Mocks @/lib/supabase/auth-guard and
// @/lib/services/report-engine-service (same convention as
// src/app/api/metric-alert-rules/route.test.ts), so this proves only the
// route's own wiring: a below-minimum-role caller is rejected with the
// gate's own 403 before createReportDefinition() is ever called, and an
// at-minimum-role caller reaches it.
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

function makeRequest(): Request {
  return new Request("http://localhost/api/reports/definitions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Def", description: "D", category: "compliance", classifications: [], executionType: "deterministic_aggregation", executionConfig: {} }),
  })
}

// mock.module() replaces the WHOLE module for the whole test process -- the
// sibling [id]/route.test.ts imports updateReportDefinition/
// deleteReportDefinition from this same module, so spreading the real module
// first (rather than a bare object literal) keeps those exports intact
// regardless of file/test run order.
async function mockService(createReportDefinition: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/report-engine-service")
  mock.module("@/lib/services/report-engine-service", () => ({ ...actual, createReportDefinition, ServiceError: FakeServiceError }))
}

// report-engine-service.ts's own dependency chain (it pulls in ~15 other
// service modules) reaches at least one module that imports hasRole from
// auth-guard -- mock.module() replaces the whole module process-wide, so
// the mock must spread the REAL module's other exports (hasRole, ROLE_RANK,
// etc.) rather than a bare object literal, or that unrelated import breaks.
async function mockAuthGuard(role: string) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(role), orgId: "org-1" })),
    requireRole: fakeRequireRole,
  }))
}

describe("POST /api/reports/definitions (access control)", () => {
  test("a role below manager (member) is rejected with 403 and createReportDefinition is never called", async () => {
    const createReportDefinition = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    await mockAuthGuard("member")
    await mockService(createReportDefinition)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createReportDefinition).not.toHaveBeenCalled()
  })

  test("a manager-rank caller is allowed through and createReportDefinition is called", async () => {
    const createReportDefinition = mock(async () => ({ id: "def-1", name: "Def" }))
    await mockAuthGuard("manager")
    await mockService(createReportDefinition)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(createReportDefinition).toHaveBeenCalledTimes(1)
  })
})
