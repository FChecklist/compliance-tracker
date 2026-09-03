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
  // The REST of auth-guard is kept: the list route's transitive imports (the
  // pipeline reached through run-submission) read hasRole from this module, and
  // a mock that replaced the whole namespace made them fail to link rather than
  // fail an assertion -- a green-looking suite proving nothing.
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...realAuthGuard,
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
const realAuthGuard = await import("@/lib/supabase/auth-guard")

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard)
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

// ---------------------------------------------------------------------------
// R67 F-26 FIX -- the SIBLING LIST's header counts.
// ---------------------------------------------------------------------------
//
// F-26 cut the pane's page size from 50 to 20 and added "Show 20 more". The
// list route still built `counts` with rows.filter(...) over the PAGE, so the
// Home / Approval Pending / In Queue badges silently capped at 20 for anyone
// with more open tasks than that -- and after one "Show 20 more" the pane
// rendered 40 rows above tabs still reading 20. The route's own comment says
// the tabs "can never disagree with the list under them", so this is the
// regression that comment forbids.
//
// The fix is a second grouped aggregate over the same predicate MINUS the
// cursor. These tests pin both halves: counts come from the aggregate (a page
// of 20 out of a set of 25 reports 25) and `groups` stays page-scoped, because
// `groups` carries the rows actually rendered.

/**
 * A db that answers BOTH statements the list route now issues: the keyset page
 * (.limit()) and the grouped total (.groupBy()). Recording which clauses each
 * chain saw is what proves the aggregate is not simply the page counted twice.
 */
function mockListDb(page: Record<string, unknown>[], totals: { status: string; n: number }[]) {
  const seen = { limits: 0, groupBys: 0, orgIds: [] as string[] }
  const withTenantContext = mock(async (c: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
    seen.orgIds.push(c.orgId)
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.leftJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => { seen.limits += 1; return Promise.resolve(page) }
    chain.groupBy = () => { seen.groupBys += 1; return Promise.resolve(totals) }
    return fn({ select: () => chain })
  })
  mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext }))
  return seen
}

function listRequest(query = "?limit=20") {
  return { url: `https://veridian.test/api/v1/projexa/tasks${query}` } as never
}

describe("GET /api/v1/projexa/tasks -- header counts (R67 F-26 fix)", () => {
  // 25 tasks in the set: 12 need the user, 5 running, 6 done, 2 blocked.
  // The page carries 20 of them; every count below must still say 25's worth.
  const TOTALS = [
    { status: "to_do", n: 9 },
    { status: "waiting", n: 3 },
    { status: "in_progress", n: 5 },
    { status: "done", n: 6 },
    { status: "blocked", n: 2 },
  ]
  const PAGE = Array.from({ length: 20 }, (_, i) => ({
    ...TASK_ROW,
    id: `task-${i}`,
    status: i < 12 ? "to_do" : i < 17 ? "in_progress" : "done",
    createdAt: new Date(2026, 8, 3, 12, 0, i),
  }))

  test("a 20-row page out of a 25-row set reports counts.total 25, not 20", async () => {
    mockAuth({ orgId: "org-1" })
    const seen = mockListDb(PAGE, TOTALS)

    const { GET } = await import("../route")
    const res = await GET(listRequest())
    const body = (await res.json()) as {
      tasks: unknown[]
      counts: { total: number; needsYou: number; running: number; done: number; blocked: number }
    }

    expect(res.status).toBe(200)
    expect(body.tasks).toHaveLength(20)
    expect(body.counts.total).toBe(25)
    // to_do + waiting -- the "needs you" pair, both of which the page under-counts
    expect(body.counts.needsYou).toBe(12)
    expect(body.counts.running).toBe(5)
    expect(body.counts.done).toBe(6)
    // blocked appears NOWHERE on the page at all; counting the page would say 0
    expect(body.counts.blocked).toBe(2)
    expect(seen.limits).toBe(1)
    expect(seen.groupBys).toBe(1)
  })

  test("`groups` stays page-scoped -- it is what gets rendered, not what exists", async () => {
    mockAuth({ orgId: "org-1" })
    mockListDb(PAGE, TOTALS)

    const { GET } = await import("../route")
    const res = await GET(listRequest())
    const body = (await res.json()) as {
      groups: { needsYou: unknown[]; running: unknown[]; done: unknown[]; blocked: unknown[] }
    }

    expect(body.groups.needsYou).toHaveLength(12)
    expect(body.groups.running).toHaveLength(5)
    expect(body.groups.done).toHaveLength(3)
    expect(body.groups.blocked).toHaveLength(0)
  })

  test("both statements run in the CALLER'S tenant context, in ONE transaction", async () => {
    mockAuth({ orgId: "org-1" })
    const seen = mockListDb(PAGE, TOTALS)

    const { GET } = await import("../route")
    await GET(listRequest())

    expect(seen.orgIds).toEqual(["org-1"])
  })

  test("an empty set reports zeroes, not a missing count -- an unread badge is not the same as none", async () => {
    mockAuth({ orgId: "org-1" })
    mockListDb([], [])

    const { GET } = await import("../route")
    const res = await GET(listRequest())
    const body = (await res.json()) as { counts: Record<string, number>; nextCursor: string | null }

    expect(body.counts).toEqual({ needsYou: 0, running: 0, done: 0, blocked: 0, total: 0 })
    expect(body.nextCursor).toBeNull()
  })
})
