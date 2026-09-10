/// <reference types="bun-types" />
// R75 Part 2 Phase 3 (R-C04): the route half of "live-editable minutes".
// veri-meeting-service.test.ts already covers the pure share/whatsapp half of
// R-C04 (composeMeetingShareTarget) and the create DTO's action-item
// normalisation, but NOTHING in this repo before this file exercised
// PATCH /api/veri-meetings/[id]/minutes itself -- the route that turns a MoM's
// `minutes` column into something a manager can actually edit and re-save.
// The guard this proves is the one line of real logic in the route:
//   if (typeof body.minutes !== "string") return 400
// A body with `minutes: 42` or `minutes: null` must never reach
// updateMeetingMinutes -- one bad PATCH must not corrupt a saved MoM's minutes
// column with something that fails to render later.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(opts: { response?: unknown; orgId?: string | null; dbUser?: unknown; roleErr?: unknown } = {}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({
      response: opts.response ?? null,
      orgId: opts.orgId ?? "org-1",
      dbUser: opts.dbUser ?? { id: "user-1" },
    })),
    requireRole: mock(() => opts.roleErr ?? null),
  }))
}

function mockService(impl?: (meetingId: string, minutes: string) => Promise<unknown>) {
  const updateMeetingMinutes = mock(impl ?? (async (meetingId: string, minutes: string) => ({ id: meetingId, minutes })))
  mock.module("@/lib/services/veri-meeting-service", () => ({
    updateMeetingMinutes: mock(async (_ctx: unknown, meetingId: string, minutes: string) => updateMeetingMinutes(meetingId, minutes)),
    ServiceError,
  }))
  return updateMeetingMinutes
}

function req(body: unknown) {
  return { json: async () => body } as unknown as Request
}

const ctx = { params: Promise.resolve({ id: "meeting-1" }) }

describe("PATCH /api/veri-meetings/[id]/minutes -- R-C04 live-editable minutes", () => {
  test("real case: a string body is saved and the route hands back what the service returned", async () => {
    mockAuth()
    const updateMeetingMinutes = mockService(async (meetingId, minutes) => ({ id: meetingId, minutes, updatedAt: "2026-09-05" }))

    const { PATCH } = await import("./route")
    const res = await PATCH(req({ minutes: "Discussed RFI-12, agreed to close by Friday." }) as never, ctx)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "meeting-1", minutes: "Discussed RFI-12, agreed to close by Friday.", updatedAt: "2026-09-05" })
    expect(updateMeetingMinutes).toHaveBeenCalledTimes(1)
    expect(updateMeetingMinutes).toHaveBeenCalledWith("meeting-1", "Discussed RFI-12, agreed to close by Friday.")
  })

  test("a non-string minutes value (e.g. a number) is refused with 400 -- never forwarded to the service", async () => {
    mockAuth()
    const updateMeetingMinutes = mockService()

    const { PATCH } = await import("./route")
    const res = await PATCH(req({ minutes: 42 }) as never, ctx)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "minutes is required" })
    expect(updateMeetingMinutes).not.toHaveBeenCalled()
  })

  test("a null minutes value is refused with 400 -- never forwarded to the service", async () => {
    mockAuth()
    const updateMeetingMinutes = mockService()

    const { PATCH } = await import("./route")
    const res = await PATCH(req({ minutes: null }) as never, ctx)

    expect(res.status).toBe(400)
    expect(updateMeetingMinutes).not.toHaveBeenCalled()
  })

  test("a missing minutes key is refused with 400 -- never forwarded to the service", async () => {
    mockAuth()
    const updateMeetingMinutes = mockService()

    const { PATCH } = await import("./route")
    const res = await PATCH(req({}) as never, ctx)

    expect(res.status).toBe(400)
    expect(updateMeetingMinutes).not.toHaveBeenCalled()
  })

  test("an empty string IS a valid minutes value -- clearing the minutes is a real, allowed edit", async () => {
    mockAuth()
    const updateMeetingMinutes = mockService(async (meetingId, minutes) => ({ id: meetingId, minutes }))

    const { PATCH } = await import("./route")
    const res = await PATCH(req({ minutes: "" }) as never, ctx)

    expect(res.status).toBe(200)
    expect(updateMeetingMinutes).toHaveBeenCalledWith("meeting-1", "")
  })

  test("a ServiceError from the service (e.g. meeting not found) maps to its own status, not a bare 500", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, orgId: "org-1", dbUser: { id: "user-1" } })),
      requireRole: mock(() => null),
    }))
    mock.module("@/lib/services/veri-meeting-service", () => ({
      updateMeetingMinutes: mock(async () => { throw new ServiceError("Meeting not found", 404) }),
      ServiceError,
    }))

    const { PATCH } = await import("./route")
    const res = await PATCH(req({ minutes: "Some minutes" }) as never, ctx)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Meeting not found" })
  })
})
