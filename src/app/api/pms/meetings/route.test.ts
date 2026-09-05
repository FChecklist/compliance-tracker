/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G6 pms gap-closure). POST /api/pms/meetings had NO
// role gate at all -- any authenticated org member could schedule a project
// meeting. Fixed to require "member", matching this exact createMeeting()
// call's own already-gated PROJEXA-facing sibling: POST
// /api/v1/projexa/meetings (Wave 141, same pms-meeting-service.ts
// createMeeting()) is gated at requireRoleOrScope(ctx, "member", "write").
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
  return new Request("http://localhost/api/pms/meetings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/pms/meetings (access control)", () => {
  test("a viewer (below member) is rejected with 403 and createMeeting is never called", async () => {
    const createMeeting = mock(async () => { throw new Error("createMeeting should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-meeting-service", () => ({
      listMeetings: mock(async () => []),
      createMeeting,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", title: "Sprint review", scheduledAt: "2026-09-10T10:00:00Z" }) as any)
    expect(res.status).toBe(403)
    expect(createMeeting).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and createMeeting is called", async () => {
    const createMeeting = mock(async () => ({ id: "meeting-1", title: "Sprint review" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-meeting-service", () => ({
      listMeetings: mock(async () => []),
      createMeeting,
    }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ projectId: "proj-1", title: "Sprint review", scheduledAt: "2026-09-10T10:00:00Z" }) as any)
    expect(res.status).not.toBe(403)
    expect(createMeeting).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
