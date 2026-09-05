/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST
// /api/gst-reconciliation/returns/[returnPeriodId]/ai-review had NO role
// gate at all -- a real, costly AI call over an org's GST financial-
// reconciliation data. Fixed to require "senior_professional", matching the
// established bar for every OTHER write in this exact module (import
// confirm, reconcile run, returns create).
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

class FakeAiReviewUnavailableError extends Error {}

function makeRequest(): Request {
  return new Request("http://localhost/api/gst-reconciliation/returns/period-1/ai-review", {
    method: "POST",
  })
}

const params = Promise.resolve({ returnPeriodId: "period-1" })

describe("POST /api/gst-reconciliation/returns/[returnPeriodId]/ai-review (access control)", () => {
  test("a member (below senior_professional) is rejected with 403 and the AI review service is never called", async () => {
    const generateReviewReport = mock(async () => { throw new Error("generateReviewReport should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/gst-reconciliation-service", () => ({
      generateReviewReport,
      getLatestReviewReport: mock(async () => null),
      ServiceError: FakeServiceError,
    }))
    mock.module("@/lib/gst/ai-review-report", () => ({
      AiReviewUnavailableError: FakeAiReviewUnavailableError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params } as any)
    expect(res.status).toBe(403)
    expect(generateReviewReport).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a senior_professional-rank user passes the role gate and the AI review service is called", async () => {
    const generateReviewReport = mock(async () => ({ id: "review-1" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("senior_professional"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/gst-reconciliation-service", () => ({
      generateReviewReport,
      getLatestReviewReport: mock(async () => null),
      ServiceError: FakeServiceError,
    }))
    mock.module("@/lib/gst/ai-review-report", () => ({
      AiReviewUnavailableError: FakeAiReviewUnavailableError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(generateReviewReport).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
