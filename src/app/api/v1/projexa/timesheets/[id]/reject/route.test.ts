/// <reference types="bun-types" />
// Thin proxy wiring test (Task #47 PROJEXA timesheet bridge). Same
// coverage shape as ../approve/route.test.ts, plus the reject-only
// concern: the optional `rejectionReason` body field is forwarded
// unchanged, and a missing/non-JSON body doesn't 500 (matches the internal
// /api/pms/time-entries/[id]/reject/route.ts's own `.json().catch(() => ({}))`).
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

function dbUser(role: string, id = "manager-1") {
  return { id, role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }
  const userRank = RANK[user?.role] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function mockAuth(ctx: { orgId: string | null; dbUser?: any; apiKey?: any; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.dbUser ?? null,
      apiKey: ctx.apiKey ?? null,
      response: ctx.response ?? null,
    })),
    requireRole: fakeRequireRole,
  }))
}

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Spreads the real module's other exports so this file's mock doesn't
// shadow-out exports the sibling ../submit and ../approve route test files
// need -- bun:test's mock.module() replaces the module in a process-wide
// registry shared across test files in the same `bun test` run, not
// per-file.
async function mockService(opts: { rejectTimeEntry?: ReturnType<typeof mock> }) {
  const actual = await import("@/lib/services/pms-time-service")
  mock.module("@/lib/services/pms-time-service", () => ({
    ...actual,
    rejectTimeEntry: opts.rejectTimeEntry ?? mock(async () => ({})),
    ServiceError: FakeServiceError,
  }))
}

function postRequest(id = "entry-1", body?: unknown) {
  const init: RequestInit = { method: "POST" }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "content-type": "application/json" }
  }
  return { req: new NextRequest(`http://localhost/api/v1/projexa/timesheets/${id}/reject`, init), params: Promise.resolve({ id }) }
}

describe("POST /api/v1/projexa/timesheets/[id]/reject", () => {
  test("a member (below manager) is rejected 403 and rejectTimeEntry is never called", async () => {
    const rejectTimeEntry = mock(async () => { throw new Error("should not be called") })
    mockAuth({ orgId: "org-1", dbUser: dbUser("member") })
    await mockService({ rejectTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(403)
    expect(rejectTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank session rejects successfully and forwards rejectionReason from the body", async () => {
    const rejectTimeEntry = mock(async () => ({ id: "entry-1", approvalStatus: "rejected", rejectionReason: "Hours look wrong" }))
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    await mockService({ rejectTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest("entry-1", { rejectionReason: "Hours look wrong" })
    const res = await POST(req as any, { params })

    expect(res.status).toBe(200)
    expect(rejectTimeEntry).toHaveBeenCalledWith({ orgId: "org-1", userId: "manager-1" }, "entry-1", "Hours look wrong")
    expect(await res.json()).toEqual({ id: "entry-1", approvalStatus: "rejected", rejectionReason: "Hours look wrong" })
    mock.restore()
  })

  test("a missing/empty body does not 500 -- rejectionReason is passed through as undefined", async () => {
    const rejectTimeEntry = mock(async () => ({ id: "entry-1", approvalStatus: "rejected" }))
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    await mockService({ rejectTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(200)
    expect(rejectTimeEntry).toHaveBeenCalledWith({ orgId: "org-1", userId: "manager-1" }, "entry-1", undefined)
    mock.restore()
  })

  test("an org-scoped API key with no real user session is rejected before the role check even runs", async () => {
    const rejectTimeEntry = mock(async () => { throw new Error("should not be called") })
    mockAuth({ orgId: "org-1", apiKey: { id: "key-1", name: "Test Key", scopes: ["read", "write"] } })
    await mockService({ rejectTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "This action requires a real user session, not an API key" })
    expect(rejectTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("rejecting an already-reviewed entry surfaces the service's real 400, not a generic 500", async () => {
    const rejectTimeEntry = mock(async () => { throw new FakeServiceError("Only a submitted time entry can be reviewed", 400) })
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    await mockService({ rejectTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Only a submitted time entry can be reviewed" })
    mock.restore()
  })

  test("a manager trying to reject their own submitted entry gets the service's 403 self-review block", async () => {
    const rejectTimeEntry = mock(async () => { throw new FakeServiceError("The submitter cannot review their own time entry", 403) })
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    await mockService({ rejectTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "The submitter cannot review their own time entry" })
    mock.restore()
  })
})
