/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "member")
// gate added to POST /api/veri-meetings/[id]/generate-intelligence -- see the
// route's own comment for why "member" (this session's established AI-call
// bar, per the G1/G4/G5 help/ask precedent) was chosen over this file's
// OTHER sibling routes' "manager" bar for mutating the locked meeting record.
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
  return new Request("http://localhost/api/veri-meetings/meeting-1/generate-intelligence", { method: "POST" })
}

describe("POST /api/veri-meetings/[id]/generate-intelligence (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and generateMeetingIntelligence is never called", async () => {
    const generateMeetingIntelligence = mock(async () => { throw new Error("generateMeetingIntelligence should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/veri-meeting-service", () => ({
      generateMeetingIntelligence,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(new Request("http://localhost/x") as any, { params: Promise.resolve({ id: "meeting-1" }) })
    expect(res.status).toBe(403)
    expect(generateMeetingIntelligence).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank caller passes the role gate and intelligence is generated", async () => {
    const generateMeetingIntelligence = mock(async () => ({ id: "meeting-1", aiSummary: "Summary" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/veri-meeting-service", () => ({
      generateMeetingIntelligence,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any, { params: Promise.resolve({ id: "meeting-1" }) })
    expect(res.status).toBe(200)
    expect(generateMeetingIntelligence).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
