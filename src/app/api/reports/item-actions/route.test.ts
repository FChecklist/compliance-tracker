/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports): proves the requireRole(dbUser, "member")
// gate added to POST /api/reports/item-actions -- this route previously had
// no role check at all beyond a real session. This route only records that
// the current user acknowledged/delegated/to-do'd a report row (see
// report-item-action-service.ts's own header) -- a genuinely low-stakes
// action, so "member" is the floor, not "manager". Mocks
// @/lib/supabase/auth-guard and @/lib/services/report-item-action-service
// (same convention as src/app/api/metric-alert-rules/route.test.ts).
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
  return new Request("http://localhost/api/reports/item-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportId: "report-1", rowId: "row-1", action: "accept" }),
  })
}

describe("POST /api/reports/item-actions (access control)", () => {
  test("a viewer (below member) is rejected with 403 and createReportItemAction is never called", async () => {
    const createReportItemAction = mock(async () => { throw new Error("should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/report-item-action-service", () => ({
      createReportItemAction,
      listReportItemActions: mock(async () => []),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createReportItemAction).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and createReportItemAction is called", async () => {
    const createReportItemAction = mock(async () => ({ id: "action-1", action: "accept" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/report-item-action-service", () => ({
      createReportItemAction,
      listReportItemActions: mock(async () => []),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(createReportItemAction).toHaveBeenCalledTimes(1)
  })
})
