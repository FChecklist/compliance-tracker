/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G4 reports). This route runs a real, costly AI vision/
// text call proposing a report from an uploaded file; tenant scoping alone
// is not a role restriction, and this route previously had no role floor at
// all. Fixed to require "member", matching construction/ai/estimate-progress's
// own POST floor (R75 Phase 5 G1) -- the same class of action, an AI call
// consuming caller-supplied data.
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
  const formData = new FormData()
  formData.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }))
  return new Request("http://localhost/api/reports/ai-builder/analyze", {
    method: "POST",
    body: formData,
  })
}

describe("POST /api/reports/ai-builder/analyze (access control)", () => {
  test("a viewer (below member) is rejected with 403 and the AI proposal service is never called", async () => {
    const proposeReportFromUpload = mock(async () => { throw new Error("proposeReportFromUpload should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ai-report-builder-service", () => ({
      proposeReportFromUpload,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(proposeReportFromUpload).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and the AI proposal service is called", async () => {
    const proposeReportFromUpload = mock(async () => ({ proposal: { title: "T", summary: "S", columns: [], rows: [], chartType: "table", chartRows: [] }, extractedPreview: "preview" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/ai-report-builder-service", () => ({
      proposeReportFromUpload,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).not.toBe(403)
    expect(proposeReportFromUpload).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
