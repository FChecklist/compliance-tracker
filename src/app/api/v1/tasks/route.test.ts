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
    // route.ts's top-level `import { requireAuthOrApiKey, requireRoleOrScope }`
    // needs BOTH names to exist on whatever mock is active the moment
    // "./route" is first dynamically imported in this file (a named ESM
    // import fails to link -- "Export named 'X' not found" -- if either is
    // missing, even for a GET test that never calls this one). GET never
    // reaches this gate (added by the POST-only fix below), so a permissive
    // always-pass stub is enough here.
    requireRoleOrScope: () => null,
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

// R75 Part 2 Phase 5 (G8-misc): proves the requireRoleOrScope(ctx, "member")
// gate added to POST /api/v1/tasks -- this route had no role check at all
// beyond a real session/API key, unlike its sibling non-v1 POST /api/tasks
// (which already gated on "member"). Mocks @/lib/supabase/auth-guard and
// @/lib/services/task-service (same convention as
// src/app/api/pms/time-entries/[id]/approve/route.test.ts), so this proves
// only the route's own wiring: a below-minimum-role session caller is
// rejected with the gate's own 403 before createTask() is ever called, and
// an at-minimum-role caller reaches it. Uses its own local helpers (distinct
// names from the GET describe block above) so each block's mock.module
// calls stay self-contained within their own tests.
const ROLE_GATE_RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }

function fakeRequireRoleOrScope(ctx: { dbUser?: { role: string } | null; apiKey?: unknown }, minimumRole: string) {
  if (ctx?.dbUser) {
    const userRank = ROLE_GATE_RANK[ctx.dbUser.role] ?? 0
    const requiredRank = ROLE_GATE_RANK[minimumRole] ?? 99
    if (userRank < requiredRank) {
      return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
    }
    return null
  }
  if (ctx?.apiKey) return null
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any
}

function roleGateDbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makePostRequest(): Request {
  return new Request("http://localhost/api/v1/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Do the thing" }),
  })
}

describe("POST /api/v1/tasks (access control)", () => {
  test("a role below member (viewer) is rejected with 403 and createTask is never called", async () => {
    const createTask = mock(async () => { throw new Error("createTask should not be called for a below-minimum role") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ response: null, dbUser: roleGateDbUser("viewer"), orgId: "org-1", apiKey: null })),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/task-service", () => ({
      createTask, listTasks: mock(async () => ({ tasks: [] })),
      ServiceError,
    }))
    const { POST } = await import("./route")
    const res = await POST(makePostRequest() as any)
    expect(res.status).toBe(403)
    expect(createTask).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and createTask is called", async () => {
    const createTask = mock(async () => ({ id: "task-1", title: "Do the thing" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ response: null, dbUser: roleGateDbUser("member"), orgId: "org-1", apiKey: null })),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/task-service", () => ({
      createTask, listTasks: mock(async () => ({ tasks: [] })),
      ServiceError,
    }))
    const { POST } = await import("./route")
    const res = await POST(makePostRequest() as any)
    expect(res.status).toBe(201)
    expect(createTask).toHaveBeenCalledTimes(1)
  })
})
