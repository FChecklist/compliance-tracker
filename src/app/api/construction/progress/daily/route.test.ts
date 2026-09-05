/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). This route uploads a photo
// attachment to a project's daily progress report (createDocumentRecord)
// and previously had no role floor beyond org membership. Fixed to require
// "member", matching construction/progress/route.ts's own POST floor (same
// service file, construction-progress-service.ts, same write weight).
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
  const form = new FormData()
  form.set("projectId", "proj-1")
  form.set("date", "2026-09-01")
  form.set("file", new File(["fake-image-bytes"], "site.jpg", { type: "image/jpeg" }))
  return new Request("http://localhost/api/construction/progress/daily", { method: "POST", body: form })
}

describe("POST /api/construction/progress/daily (access control)", () => {
  test("a viewer (below member) is rejected with 403 and createDocumentRecord is never called", async () => {
    const createDocumentRecord = mock(async () => { throw new Error("createDocumentRecord should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/document-service", () => ({ createDocumentRecord }))
    mock.module("@/lib/services/construction-progress-service", () => ({
      getDailyProgressReport: mock(async () => ({})),
      dailyProgressReportLinkId: (projectId: string, date: string) => `${projectId}:${date}`,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createDocumentRecord).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and createDocumentRecord is called", async () => {
    const createDocumentRecord = mock(async () => ({ id: "doc-1", name: "site.jpg" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/document-service", () => ({ createDocumentRecord }))
    mock.module("@/lib/services/construction-progress-service", () => ({
      getDailyProgressReport: mock(async () => ({})),
      dailyProgressReportLinkId: (projectId: string, date: string) => `${projectId}:${date}`,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(201)
    expect(createDocumentRecord).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
