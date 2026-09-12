/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G7 final): proves the requireRole(dbUser, "member")
// gate added to POST /api/veri-meetings/[id]/action-items -- see the route's
// own comment for why "member" (not this file's OTHER sibling routes'
// "manager" bar) was chosen: adding an action item just creates a task,
// matched to POST /api/tasks's "member" floor.
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
  return new Request("http://localhost/api/veri-meetings/meeting-1/action-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/veri-meetings/[id]/action-items (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and addMeetingActionItem is never called", async () => {
    const addMeetingActionItem = mock(async () => { throw new Error("addMeetingActionItem should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/veri-meeting-service", () => ({
      addMeetingActionItem,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ title: "Follow up" }) as any, { params: Promise.resolve({ id: "meeting-1" }) })
    expect(res.status).toBe(403)
    expect(addMeetingActionItem).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank caller passes the role gate and the action item is added", async () => {
    const addMeetingActionItem = mock(async () => ({ id: "ai-1", meetingId: "meeting-1", task: { id: "task-1", title: "Follow up" } }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/veri-meeting-service", () => ({
      addMeetingActionItem,
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ title: "Follow up" }) as any, { params: Promise.resolve({ id: "meeting-1" }) })
    expect(res.status).toBe(201)
    expect(addMeetingActionItem).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
