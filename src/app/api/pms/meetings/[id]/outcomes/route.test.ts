/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G6 pms gap-closure). POST
// /api/pms/meetings/[id]/outcomes had NO role gate at all -- any
// authenticated org member could record a meeting's outcome/minutes. Fixed
// to require "member", matching this exact addMeetingOutcome() call's own
// already-gated PROJEXA-facing sibling: POST
// /api/v1/projexa/meetings/[id]/outcomes (Wave 141, same
// pms-meeting-service.ts addMeetingOutcome()) is gated at
// requireRoleOrScope(ctx, "member", "write"). Also matches
// POST /api/pms/meetings's own member bar (see that file's own test).
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
  return new Request("http://localhost/api/pms/meetings/meeting-1/outcomes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: "meeting-1" })

describe("POST /api/pms/meetings/[id]/outcomes (access control)", () => {
  test("a viewer (below member) is rejected with 403 and addMeetingOutcome is never called", async () => {
    const addMeetingOutcome = mock(async () => { throw new Error("addMeetingOutcome should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-meeting-service", () => ({ addMeetingOutcome }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ notes: "Agreed on scope" }) as any, { params } as any)
    expect(res.status).toBe(403)
    expect(addMeetingOutcome).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and addMeetingOutcome is called", async () => {
    const addMeetingOutcome = mock(async () => ({ id: "outcome-1", notes: "Agreed on scope" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/services/pms-meeting-service", () => ({ addMeetingOutcome }))
    mock.module("@/lib/services/pms-enablement-service", () => ({
      requirePmsEnabled: mock(async () => {}),
      ServiceError: FakeServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ notes: "Agreed on scope" }) as any, { params } as any)
    expect(res.status).not.toBe(403)
    expect(addMeetingOutcome).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
