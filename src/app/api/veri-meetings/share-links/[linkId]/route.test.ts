/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "manager")
// gate added to DELETE /api/veri-meetings/share-links/[linkId] -- see the
// route's own comment for why "manager" was chosen (matched to its direct
// sibling, POST ../../[id]/share-links's already-established "manager" bar
// for creating a share link -- revoke is the exact inverse action).
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
  return new Request("http://localhost/api/veri-meetings/share-links/link-1", { method: "DELETE" })
}

describe("DELETE /api/veri-meetings/share-links/[linkId] (access control)", () => {
  test("a role below manager (member) is rejected with 403 and revokeMeetingShareLink is never called", async () => {
    const revokeMeetingShareLink = mock(async () => { throw new Error("revokeMeetingShareLink should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/veri-meeting-service", () => ({
      revokeMeetingShareLink,
      ServiceError: FakeServiceError,
    }))

    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest() as any, { params: Promise.resolve({ linkId: "link-1" }) })
    expect(res.status).toBe(403)
    expect(revokeMeetingShareLink).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank caller passes the role gate and the share link is revoked", async () => {
    const revokeMeetingShareLink = mock(async () => ({ id: "link-1", revokedAt: new Date("2026-09-05T00:00:00.000Z") }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("manager"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/veri-meeting-service", () => ({
      revokeMeetingShareLink,
      ServiceError: FakeServiceError,
    }))

    const { DELETE } = await import("./route")
    const res = await DELETE(makeRequest() as any, { params: Promise.resolve({ linkId: "link-1" }) })
    expect(res.status).toBe(200)
    expect(revokeMeetingShareLink).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
