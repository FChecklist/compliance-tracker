/// <reference types="bun-types" />
// Thin proxy wiring test (Task #47 PROJEXA timesheet bridge). Proves this
// route replicates the internal /api/pms/time-entries/[id]/approve/route.ts's
// own access control exactly (manager rank or above only, real session
// required) before ever reaching approveTimeEntry(), and that a real
// ServiceError (e.g. reviewing an already-approved entry, or self-review)
// surfaces its real status/message. Same fakeRequireRole rank table as
// ../../../../pms/time-entries/[id]/approve/route.test.ts.
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
// shadow-out exports the sibling ../submit and ../reject route test files
// need -- bun:test's mock.module() replaces the module in a process-wide
// registry shared across test files in the same `bun test` run, not
// per-file.
async function mockService(opts: { approveTimeEntry?: ReturnType<typeof mock> }) {
  const actual = await import("@/lib/services/pms-time-service")
  mock.module("@/lib/services/pms-time-service", () => ({
    ...actual,
    approveTimeEntry: opts.approveTimeEntry ?? mock(async () => ({})),
    ServiceError: FakeServiceError,
  }))
}

function postRequest(id = "entry-1") {
  return { req: new NextRequest(`http://localhost/api/v1/projexa/timesheets/${id}/approve`, { method: "POST" }), params: Promise.resolve({ id }) }
}

describe("POST /api/v1/projexa/timesheets/[id]/approve", () => {
  test("a member (below manager) is rejected 403 and approveTimeEntry is never called", async () => {
    const approveTimeEntry = mock(async () => { throw new Error("should not be called") })
    mockAuth({ orgId: "org-1", dbUser: dbUser("member") })
    await mockService({ approveTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(403)
    expect(approveTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a manager-rank session approves successfully", async () => {
    const approveTimeEntry = mock(async () => ({ id: "entry-1", approvalStatus: "approved" }))
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    await mockService({ approveTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(200)
    expect(approveTimeEntry).toHaveBeenCalledWith({ orgId: "org-1", userId: "manager-1" }, "entry-1")
    expect(await res.json()).toEqual({ id: "entry-1", approvalStatus: "approved" })
    mock.restore()
  })

  test("an admin-rank session (above manager) is also allowed through", async () => {
    const approveTimeEntry = mock(async () => ({ id: "entry-1", approvalStatus: "approved" }))
    mockAuth({ orgId: "org-1", dbUser: dbUser("admin", "admin-1") })
    await mockService({ approveTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(200)
    expect(approveTimeEntry).toHaveBeenCalledWith({ orgId: "org-1", userId: "admin-1" }, "entry-1")
    mock.restore()
  })

  test("an org-scoped API key with no real user session is rejected before the role check even runs", async () => {
    const approveTimeEntry = mock(async () => { throw new Error("should not be called") })
    mockAuth({ orgId: "org-1", apiKey: { id: "key-1", name: "Test Key", scopes: ["read", "write"] } })
    await mockService({ approveTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "This action requires a real user session, not an API key" })
    expect(approveTimeEntry).not.toHaveBeenCalled()
    mock.restore()
  })

  test("approving an already-approved (non-submitted) entry surfaces the service's real 400, not a generic 500", async () => {
    const approveTimeEntry = mock(async () => { throw new FakeServiceError("Only a submitted time entry can be reviewed", 400) })
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    await mockService({ approveTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Only a submitted time entry can be reviewed" })
    mock.restore()
  })

  test("a manager trying to approve their own submitted entry gets the service's 403 self-review block", async () => {
    const approveTimeEntry = mock(async () => { throw new FakeServiceError("The submitter cannot review their own time entry", 403) })
    mockAuth({ orgId: "org-1", dbUser: dbUser("manager") })
    await mockService({ approveTimeEntry })

    const { POST } = await import("./route")
    const { req, params } = postRequest()
    const res = await POST(req as any, { params })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "The submitter cannot review their own time entry" })
    mock.restore()
  })
})
