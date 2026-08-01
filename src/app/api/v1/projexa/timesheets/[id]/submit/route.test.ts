/// <reference types="bun-types" />
// Thin proxy wiring test (Task #47 PROJEXA timesheet bridge) -- proves this
// route (a) only reaches submitTimeEntry() for a real logged-in session,
// never a bare API key, (b) passes through the auth-guard's 401/400 gates
// untouched, and (c) surfaces a ServiceError's real status/message (e.g.
// "already submitted") rather than masking it as a generic 500. Mirrors
// ../../../../pms/time-entries/[id]/approve/route.test.ts's mocking style
// and module-chain/route.test.ts's request-building convention.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

function dbUser(id = "user-1") {
  return { id, role: "member", orgId: "org-1" } as any
}

function mockAuth(ctx: { orgId: string | null; dbUser?: any; apiKey?: any; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.dbUser ?? null,
      apiKey: ctx.apiKey ?? null,
      response: ctx.response ?? null,
    })),
  }))
}

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Spreads the real module's other exports (approveTimeEntry, rejectTimeEntry,
// listTimeEntriesForProject, etc.) so this file's mock doesn't shadow-out
// exports the sibling ../approve and ../reject route test files need --
// bun:test's mock.module() replaces the module in a process-wide registry
// shared across test files in the same `bun test` run, not per-file.
async function mockService(opts: { submitTimeEntry?: ReturnType<typeof mock> }) {
  const actual = await import("@/lib/services/pms-time-service")
  mock.module("@/lib/services/pms-time-service", () => ({
    ...actual,
    submitTimeEntry: opts.submitTimeEntry ?? mock(async () => ({})),
    ServiceError: FakeServiceError,
  }))
}

function postRequest(id = "entry-1") {
  return { req: new NextRequest(`http://localhost/api/v1/projexa/timesheets/${id}/submit`, { method: "POST" }), params: Promise.resolve({ id }) }
}

describe("POST /api/v1/projexa/timesheets/[id]/submit", () => {
  test("a real session submits successfully and the entry is returned", async () => {
    const submitTimeEntry = mock(async () => ({ id: "entry-1", approvalStatus: "submitted" }))
    mockAuth({ orgId: "org-1", dbUser: dbUser("user-1") })
    await mockService({ submitTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(200)
    expect(submitTimeEntry).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "entry-1")
    expect(await res.json()).toEqual({ id: "entry-1", approvalStatus: "submitted" })
    mock.restore()
  })

  test("an invalid/missing API key never reaches submitTimeEntry", async () => {
    const submitTimeEntry = mock(async () => { throw new Error("should not be called") })
    mockAuth({ orgId: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) })
    await mockService({ submitTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(401)
    expect(submitTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("an org-scoped API key with no real user session is rejected -- submit requires individual identity", async () => {
    const submitTimeEntry = mock(async () => { throw new Error("should not be called") })
    mockAuth({ orgId: "org-1", apiKey: { id: "key-1", name: "Test Key", scopes: ["read", "write"] } })
    await mockService({ submitTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "This action requires a real user session, not an API key" })
    expect(submitTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("no organisation on the account -> 400, submitTimeEntry never called", async () => {
    const submitTimeEntry = mock(async () => { throw new Error("should not be called") })
    mockAuth({ orgId: null, dbUser: dbUser() })
    await mockService({ submitTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(400)
    expect(submitTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("submitting an already-submitted entry surfaces the service's real error status/message, not a generic 500", async () => {
    const submitTimeEntry = mock(async () => { throw new FakeServiceError("Only a draft time entry can be submitted", 400) })
    mockAuth({ orgId: "org-1", dbUser: dbUser("user-1") })
    await mockService({ submitTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Only a draft time entry can be submitted" })
    mock.restore()
  })

  test("submitting someone else's entry surfaces the service's 403", async () => {
    const submitTimeEntry = mock(async () => { throw new FakeServiceError("Only the logging user may submit this entry", 403) })
    mockAuth({ orgId: "org-1", dbUser: dbUser("user-2") })
    await mockService({ submitTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "Only the logging user may submit this entry" })
    mock.restore()
  })
})
