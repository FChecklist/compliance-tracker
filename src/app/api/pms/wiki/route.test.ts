/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G6 pms gap-closure). POST /api/pms/wiki had NO role
// gate at all -- any authenticated org member could create a project wiki
// page. Fixed to require "member", the same bar as this codebase's own
// knowledge-base-service.ts sibling: pms-wiki-service.ts's createWikiPage()
// explicitly reuses knowledge-base-service.ts's createKbPage() isRealUser
// mechanism (see that function's own header comment), and
// POST /api/knowledge-base/pages -- the route that calls createKbPage() --
// is gated at requireRole(dbUser, "member"). Also matches this exact PMS
// module's own bar for issue create/edit (POST/PATCH /api/pms/issues).
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
  return new Request("http://localhost/api/pms/wiki", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/pms/wiki (access control)", () => {
  test("a viewer (below member) is rejected with 403 and createWikiPage is never called", async () => {
    const createWikiPage = mock(async () => { throw new Error("createWikiPage should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-wiki-service", () => ({
      listWikiPages: mock(async () => []),
      createWikiPage,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", title: "Onboarding" }) as any)
    expect(res.status).toBe(403)
    expect(createWikiPage).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and createWikiPage is called", async () => {
    const createWikiPage = mock(async () => ({ id: "page-1", title: "Onboarding" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-wiki-service", () => ({
      listWikiPages: mock(async () => []),
      createWikiPage,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", title: "Onboarding" }) as any)
    expect(res.status).not.toBe(403)
    expect(createWikiPage).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
