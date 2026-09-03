/// <reference types="bun-types" />
// R43_MGR_02 (wf_test backfill, R62 B7): proves the ba95c25e fix (PR #1393)
// -- bounding request.json() to REQUEST_BODY_READ_TIMEOUT_MS via
// readJsonBody()'s Promise.race -- actually stops POST /v1/projexa/timesheets
// from riding a stalled/incomplete request body all the way to Vercel's 300s
// hard cap with zero HTTP response ever sent. Confirmed still live and
// unaffected on top of PR #1438's requireOrg() sweep (that PR only touched
// this file's GET orgId guard; the POST handler / readJsonBody() are
// untouched -- see git diff 6fc70607~1..6fc70607 -- route.ts).
//
// The route's own timeout constant is 25_000ms -- too slow for a unit test.
// Rather than touch the fix's source to make it test-configurable (which
// would be its own kind of weakening), this patches the *global* setTimeout
// so the route's internal timer fires almost immediately instead of waiting
// out its real delay, while request.json() itself is mocked to hang forever
// (a Promise that never resolves -- the real shape of a stalled body). The
// test itself races POST() against a short real-time ceiling: if the fix's
// timeout branch is what actually resolves the race, POST returns 408 well
// inside that ceiling; if the readJsonBody() wrapper were ever removed
// (reverting to a bare `await request.json()`), our global.setTimeout patch
// is irrelevant to that reverted code (it never calls setTimeout for the
// body read at all) and POST hangs forever -- the test-side ceiling fires
// first and the test fails. That is: this test fails without the fix
// (real hang, never returns) and passes with it (bounded 408).
import { describe, test, expect, mock, afterEach } from "bun:test"

const originalSetTimeout = globalThis.setTimeout

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null; dbUser?: unknown }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.dbUser ?? (ctx.orgId ? { id: "user-1" } : null),
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    resolveActingUser: mock(async (c: any) => ({ user: c.dbUser, error: null })),
    // R67 WS-H (D-05): the handler now reads the X-Acting-User header
    // through this helper, so the module mock must export it too or the
    // dynamic import below fails at load time -- the same reason requireOrg
    // is listed here (see the comment below).
    readActingUserId: mock(() => null),
    readActingUserEmail: mock(() => null),
    // PR #1438's requireOrg() sweep added this to the GET handler in this
    // same file -- the module mock must export it too or the dynamic
    // `import("./route")` below fails at load time with "Export named
    // 'requireOrg' not found", never even reaching the POST test.
    requireOrg: mock((c: any) => (c.orgId ? null : new Response(JSON.stringify({ error: "No organisation on this account" }), { status: 400 }))),
  }))
}

function mockService(implOverride?: () => Promise<unknown>) {
  const logTime = mock(implOverride ?? (async () => ({ id: "entry-1" })))
  mock.module("@/lib/services/pms-time-service", () => ({
    listTimeEntriesForProject: mock(async () => []),
    listTimeEntriesForIssue: mock(async () => []),
    logTime,
    ServiceError,
  }))
  return logTime
}

// A request whose body never arrives -- .json() returns a Promise that
// never settles, the real shape of a stalled/incomplete body on the wire.
function hangingBodyRequest() {
  return {
    nextUrl: new URL("http://localhost/api/v1/projexa/timesheets"),
    json: () => new Promise(() => {}),
  }
}

function normalBodyRequest(body: unknown) {
  return {
    nextUrl: new URL("http://localhost/api/v1/projexa/timesheets"),
    json: async () => body,
  }
}

// Races an arbitrary promise against a short real-time ceiling. Resolves to
// { timedOut: true } if the ceiling wins (i.e. the promise never settled in
// time) instead of letting a genuinely hung POST() block the test suite
// forever. Takes an explicit `scheduler` (the real, pre-patch setTimeout)
// rather than reading the ambient global -- the test below patches
// globalThis.setTimeout so the route's OWN internal timer fires fast, and
// if this ceiling used that same patched global it would collapse to the
// same ~5ms delay and could win the race purely on registration order,
// not because the route actually hung. Using the untouched original here
// keeps the ceiling a genuine, generous real-time budget.
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

describe("POST /api/v1/projexa/timesheets -- R43_MGR_02 body-read timeout", () => {
  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
  })

  test("a stalled request body fails fast with 408 instead of hanging forever (real fail-without-fix / pass-with-fix probe)", async () => {
    // Patch the global timer so the route's internal 25s ceiling fires in
    // ~5ms instead. This only helps if the route code path actually calls
    // setTimeout to bound the body read -- a reverted route that goes back
    // to a bare `await request.json()` never calls setTimeout at all here,
    // so this patch does nothing for it and the hang is real.
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) =>
      originalSetTimeout(fn, 5, ...args)) as unknown as typeof setTimeout

    mockAuth({ orgId: "org-1" })
    const logTime = mockService()

    const { POST } = await import("./route")
    const outcome = await withCeiling(POST(hangingBodyRequest() as any), 2000)

    expect(outcome.timedOut).toBe(false)
    if (outcome.timedOut) return // unreachable, satisfies TS narrowing below
    const res = outcome.value
    expect(res.status).toBe(408)
    expect(await res.json()).toEqual({ error: "Timed out waiting for the request body" })
    expect(logTime).not.toHaveBeenCalled()
  })

  test("real case: a normal request body is read and logTime() runs and returns 201", async () => {
    mockAuth({ orgId: "org-1" })
    const logTime = mockService(async () => ({ id: "entry-1", hours: 4 }))

    const { POST } = await import("./route")
    const res = await POST(normalBodyRequest({ issueId: "issue-1", hours: 4, spentOn: "2026-08-28" }) as any)

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: "entry-1", hours: 4 })
    expect(logTime).toHaveBeenCalledTimes(1)
  })
})
