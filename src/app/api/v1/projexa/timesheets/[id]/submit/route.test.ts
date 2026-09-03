/// <reference types="bun-types" />
// R43_MGR_02 (wf_test backfill, R62 B7): sibling to
// ../../route.test.ts -- proves the ba95c25e fix (PR #1393) for
// POST /v1/projexa/timesheets/[id]/submit. This file was NOT touched by
// PR #1438's requireOrg() sweep at all (confirmed: `git show 6fc70607
// --stat` lists only the parent timesheets/route.ts, not this file), so the
// fix here is unmodified by that later merge. See ../../route.test.ts's own
// header comment for the full rationale behind the global.setTimeout patch
// + test-side ceiling technique used below.
import { describe, test, expect, mock, afterEach } from "bun:test"

const originalSetTimeout = globalThis.setTimeout

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; dbUser?: unknown }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.dbUser ?? (ctx.orgId ? { id: "user-1" } : null),
      apiKey: null,
      response: ctx.response ?? null,
    })),
    resolveActingUser: mock(async (c: any) => ({ user: c.dbUser, error: null })),
    // R67 WS-H (D-05): the handler reads the X-Acting-User header through
    // this helper now, so the module mock must export it or the dynamic
    // import("./route") below fails at load time.
    readActingUserId: mock(() => null),
  }))
}

function mockService(implOverride?: () => Promise<unknown>) {
  const submitTimeEntry = mock(implOverride ?? (async () => ({ id: "entry-1", approvalStatus: "submitted" })))
  // R67 WS-H (item H-02): the handler reads the entry back (to name the task
  // and project on the reviewer's row) and then mints that row. Both are
  // mocked here -- this file's subject is the body-read timeout, not the
  // review-task lifecycle, which has its own service test.
  mock.module("@/lib/services/pms-time-service", () => ({
    submitTimeEntry,
    getTimeEntry: mock(async () => ({ projectId: "project-1", issue: { id: "issue-1", number: 12, title: "Joinery shop drawings" } })),
    ServiceError,
  }))
  mock.module("@/lib/services/timesheet-review-task-service", () => ({
    openTimesheetReviewTask: mock(async () => ({ taskId: "task-1", created: true })),
  }))
  return submitTimeEntry
}

function hangingBodyRequest() {
  return {
    nextUrl: new URL("http://localhost/api/v1/projexa/timesheets/entry-1/submit"),
    json: () => new Promise(() => {}),
  }
}

function normalBodyRequest(body: unknown) {
  return {
    nextUrl: new URL("http://localhost/api/v1/projexa/timesheets/entry-1/submit"),
    json: async () => body,
  }
}

// See ../../route.test.ts's own comment on withCeiling: the ceiling MUST use
// the real, unpatched setTimeout, not the ambient global -- the test below
// patches globalThis.setTimeout so the route's internal timer fires fast,
// and a ceiling on that same patched clock could win purely on registration
// order rather than because POST() actually hung.
async function withCeiling<T>(
  p: Promise<T>,
  ms: number,
  scheduler: typeof setTimeout = originalSetTimeout
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  const CEILING = Symbol("test-ceiling")
  const result = await Promise.race([
    p.then((value) => ({ timedOut: false as const, value })),
    new Promise<typeof CEILING>((resolve) => scheduler(() => resolve(CEILING), ms)),
  ])
  return result === CEILING ? { timedOut: true } : (result as { timedOut: false; value: T })
}

describe("POST /api/v1/projexa/timesheets/[id]/submit -- R43_MGR_02 body-read timeout", () => {
  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
  })

  test("a stalled request body fails fast with 408 instead of hanging forever (real fail-without-fix / pass-with-fix probe)", async () => {
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) =>
      originalSetTimeout(fn, 5, ...args)) as unknown as typeof setTimeout

    mockAuth({ orgId: "org-1" })
    const submitTimeEntry = mockService()

    const { POST } = await import("./route")
    const outcome = await withCeiling(
      POST(hangingBodyRequest() as any, { params: Promise.resolve({ id: "entry-1" }) }),
      2000
    )

    expect(outcome.timedOut).toBe(false)
    if (outcome.timedOut) return
    const res = outcome.value
    expect(res.status).toBe(408)
    expect(await res.json()).toEqual({ error: "Timed out waiting for the request body" })
    expect(submitTimeEntry).not.toHaveBeenCalled()
  })

  test("real case: a normal request body is read and submitTimeEntry() runs and returns 200", async () => {
    mockAuth({ orgId: "org-1" })
    const submitTimeEntry = mockService(async () => ({ id: "entry-1", approvalStatus: "submitted" }))

    const { POST } = await import("./route")
    const res = await POST(normalBodyRequest({}) as any, { params: Promise.resolve({ id: "entry-1" }) })

    expect(res.status).toBe(200)
    // R67 WS-H (item H-02): the response now also reports what happened to
    // the reviewer's Task Master row, so the client can say "submitted, but
    // the review task was not created" instead of implying either that
    // nothing happened or that everything did.
    expect(await res.json()).toEqual({ id: "entry-1", approvalStatus: "submitted", reviewTaskCreated: true, reviewTaskError: null })
    expect(submitTimeEntry).toHaveBeenCalledTimes(1)
    expect(submitTimeEntry.mock.calls[0][1]).toBe("entry-1")
  })
})
