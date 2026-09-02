/// <reference types="bun-types" />
// R67 F-26 (audit recommendation R-242) -- GET /api/v1/projexa/tasks/{id}.
//
// This is the endpoint PROJEXA polls after a Send, instead of re-reading the
// whole 50-row list to find the one row it just created. What has to hold:
// the guards are the same as the list's (no org -> 400; below "member" -> the
// role gate's own response, before any read), a task belonging to another org
// is a 404 rather than a row, and the projection is the SAME one the list
// returns so a polled row and a listed row can never render differently.
//
// Same mock.module convention as the sibling dashboard/route.test.ts:
// auth-guard and the tenant-scoped db are both mocked, proving the route's own
// wiring rather than a live DB.
import { describe, test, expect, mock, afterEach } from "bun:test"

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
  }))
}

type Captured = { orgIds: string[]; rows: Record<string, unknown>[] }

/**
 * A db whose select() chain records nothing but returns `rows` -- the
 * assertions here are about the route's guards and its response shape. The
 * projection itself is asserted by reading the keys the route asked for.
 */
function mockDb(rows: Record<string, unknown>[]): Captured {
  const captured: Captured = { orgIds: [], rows: [] }
  const withTenantContext = mock(async (c: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
    captured.orgIds.push(c.orgId)
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
    }
    return fn({ select: (projection: Record<string, unknown>) => { captured.rows.push(projection); return chain } })
  })
  mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
  return captured
}

const realTenantScoped = await import("@/lib/db/tenant-scoped")

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

function request() {
  // requireAuthOrApiKey is mocked and never inspects the request, and this
  // route reads nothing off it -- the id arrives through `params`.
  return {} as never
}

const TASK_ROW = {
  id: "task-1",
  submissionId: "sub-1",
  projectId: "proj-1",
  derivedChain: { steps: ["Work Progress", "New entry"] },
  functionId: "record_work_progress",
  status: "in_progress",
  error: null,
  rawInput: "log 40% on skiphop",
  mode: "Projects",
}

describe("GET /api/v1/projexa/tasks/[id]", () => {
  test("returns the one task, under a `task` key", async () => {
    mockAuth({ orgId: "org-1" })
    mockDb([TASK_ROW])

    const { GET } = await import("./route")
    const res = await GET(request(), { params: Promise.resolve({ id: "task-1" }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ task: TASK_ROW })
  })

  test("a task id that resolves to nothing is a 404 -- never a 200 with an empty body the poller would read as 'finished'", async () => {
    mockAuth({ orgId: "org-1" })
    mockDb([])

    const { GET } = await import("./route")
    const res = await GET(request(), { params: Promise.resolve({ id: "someone-elses-task" }) })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Task not found" })
  })

  test("no resolvable org is a 400 before any read", async () => {
    mockAuth({ orgId: null })
    const captured = mockDb([TASK_ROW])

    const { GET } = await import("./route")
    const res = await GET(request(), { params: Promise.resolve({ id: "task-1" }) })

    expect(res.status).toBe(400)
    expect(captured.orgIds).toHaveLength(0)
  })

  test("the 'member'/'read' floor runs BEFORE the read, same as the list route", async () => {
    mockAuth({ orgId: "org-1", roleErr: new Response(JSON.stringify({ error: "Insufficient role" }), { status: 403 }) })
    const captured = mockDb([TASK_ROW])

    const { GET } = await import("./route")
    const res = await GET(request(), { params: Promise.resolve({ id: "task-1" }) })

    expect(res.status).toBe(403)
    expect(captured.orgIds).toHaveLength(0)
  })

  test("the read runs inside the CALLER'S tenant context", async () => {
    mockAuth({ orgId: "org-1" })
    const captured = mockDb([TASK_ROW])

    const { GET } = await import("./route")
    await GET(request(), { params: Promise.resolve({ id: "task-1" }) })

    expect(captured.orgIds).toEqual(["org-1"])
  })

  test("the projection carries everything the poller renders -- status, error and the derived chain", async () => {
    mockAuth({ orgId: "org-1" })
    const captured = mockDb([TASK_ROW])

    const { GET } = await import("./route")
    await GET(request(), { params: Promise.resolve({ id: "task-1" }) })

    const fields = Object.keys(captured.rows[0])
    for (const field of ["id", "status", "error", "derivedChain", "functionId", "projectId", "rawInput", "mode"]) {
      expect(fields).toContain(field)
    }
  })
})
