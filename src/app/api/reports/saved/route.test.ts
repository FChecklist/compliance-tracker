/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRole(dbUser, "member")
// gate added to POST /api/reports/saved -- this route previously had no
// role check at all beyond a real session. Saved reports only ever query
// custom-report-service.ts's own narrow, non-financial GROUP_BY_FIELDS
// whitelist, so "member" (not "manager") is the right floor. Mocks
// @/lib/supabase/auth-guard and @/lib/services/custom-report-service (same
// convention as src/app/api/metric-alert-rules/route.test.ts).
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
  return new Request("http://localhost/api/reports/saved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "My Report", sourceEntity: "compliance_items" }),
  })
}

// mock.module() replaces the WHOLE module for the whole test process -- the
// sibling [id]/route.test.ts imports updateSavedReport/deleteSavedReport
// from this same module, so spreading the real module first keeps those
// exports intact regardless of file/test run order.
async function mockService(createSavedReport: ReturnType<typeof mock>) {
  const actual = await import("@/lib/services/custom-report-service")
  mock.module("@/lib/services/custom-report-service", () => ({ ...actual, createSavedReport, ServiceError: FakeServiceError }))
}

describe("POST /api/reports/saved (access control)", () => {
  test("a viewer (below member) is rejected with 403 and createSavedReport is never called", async () => {
    const createSavedReport = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createSavedReport)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createSavedReport).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and createSavedReport is called", async () => {
    const createSavedReport = mock(async () => ({ id: "report-1", name: "My Report" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    await mockService(createSavedReport)
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(createSavedReport).toHaveBeenCalledTimes(1)
  })
})
