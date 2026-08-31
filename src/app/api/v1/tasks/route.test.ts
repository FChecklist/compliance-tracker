/// <reference types="bun-types" />
// R60 T7 (E-52 sweep, house-pattern "silent-empty-200"): GET previously
// returned 200 { tasks: [] } when ctx.orgId was falsy -- a broken org
// context looked identical to "authenticated user, zero tasks". POST in
// this same file already returned 400 "No organisation found" for the
// identical condition. Fixed to match verbatim. Same mock.module
// convention as reports/catalog/route.test.ts and
// tasks/[id]/status/route.test.ts: auth-guard and the service layer are
// both mocked, proving the route's own wiring, not a live DB.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
  }))
}

function mockService(implOverride?: () => Promise<unknown>) {
  const listTasks = mock(implOverride ?? (async () => ({ tasks: [] })))
  mock.module("@/lib/services/task-service", () => ({
    listTasks,
    createTask: mock(async () => ({ id: "task-1" })),
    ServiceError,
  }))
  return listTasks
}

function getRequest() {
  // Plain Request has no .nextUrl (that's a Next.js-specific NextRequest
  // extension) -- requireAuthOrApiKey is mocked above and never inspects
  // the request object itself, so a minimal stand-in carrying just the
  // .nextUrl the route body actually reads is enough here.
  return { nextUrl: new URL("http://localhost/api/v1/tasks") }
}

describe("GET /api/v1/tasks", () => {
  test("a caller with no resolvable org now gets 400, matching this file's own POST -- not a silent 200 empty list", async () => {
    mockAuth({ orgId: null })
    const listTasks = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "No organisation found" })
    expect(listTasks).not.toHaveBeenCalled()
  })

  test("real case: authenticated + org resolved calls listTasks with the caller's own orgId", async () => {
    mockAuth({ orgId: "org-1" })
    const listTasks = mockService(async () => ({ tasks: [{ id: "task-1", title: "File GSTR-3B" }] }))

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tasks: [{ id: "task-1", title: "File GSTR-3B" }] })
    expect(listTasks).toHaveBeenCalledTimes(1)
    expect(listTasks.mock.calls[0][0]).toEqual({ orgId: "org-1", userId: "user-1" })
  })
})
