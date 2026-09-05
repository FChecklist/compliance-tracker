/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G8-misc): proves the requireRoleOrScope(ctx, "member")
// gate added to POST /api/v1/tasks -- this route had no role check at all
// beyond a real session/API key, unlike its sibling non-v1 POST /api/tasks
// (which already gated on "member"). Mocks @/lib/supabase/auth-guard and
// @/lib/services/task-service (same convention as
// src/app/api/pms/time-entries/[id]/approve/route.test.ts), so this proves
// only the route's own wiring: a below-minimum-role session caller is
// rejected with the gate's own 403 before createTask() is ever called, and
// an at-minimum-role caller reaches it.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }

function fakeRequireRoleOrScope(ctx: { dbUser?: { role: string } | null; apiKey?: unknown }, minimumRole: string) {
  if (ctx?.dbUser) {
    const userRank = RANK[ctx.dbUser.role] ?? 0
    const requiredRank = RANK[minimumRole] ?? 99
    if (userRank < requiredRank) {
      return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
    }
    return null
  }
  if (ctx?.apiKey) return null
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any
}

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function makeRequest(): Request {
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
      requireAuthOrApiKey: mock(async () => ({ response: null, dbUser: dbUser("viewer"), orgId: "org-1", apiKey: null })),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/task-service", () => ({
      createTask, listTasks: mock(async () => ({ tasks: [] })),
      ServiceError: class extends Error { status = 400 },
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(createTask).not.toHaveBeenCalled()
  })

  test("a member-rank caller is allowed through and createTask is called", async () => {
    const createTask = mock(async () => ({ id: "task-1", title: "Do the thing" }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ response: null, dbUser: dbUser("member"), orgId: "org-1", apiKey: null })),
      requireRoleOrScope: fakeRequireRoleOrScope,
    }))
    mock.module("@/lib/services/task-service", () => ({
      createTask, listTasks: mock(async () => ({ tasks: [] })),
      ServiceError: class extends Error { status = 400 },
    }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(201)
    expect(createTask).toHaveBeenCalledTimes(1)
  })
})
