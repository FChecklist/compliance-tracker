/// <reference types="bun-types" />
// R67 F-16 (R-233) -- sibling test for the pool probe.
//
// WHY THIS ENDPOINT EXISTS. On 2026-09-02 all five app_runtime sessions sat
// "idle in transaction" for 25 minutes and every PROJEXA page 504'd. The only
// way to see that was to open a Supabase SQL session by hand -- i.e. the
// evidence existed only for someone who already suspected the cause.
//
// WHAT IS ASSERTED. Two things, and they are the two things that can silently
// go wrong with an operator endpoint: that it is genuinely closed to everyone
// below admin (the real requireRole is used, not a stub, so a change to
// ROLE_RANK would show up here), and that its one-word verdict tells the truth
// about the counts -- including the case that matters most, a session idling far
// longer than the 30 s net, which means the net is not reaching it at all.
import { beforeEach, describe, expect, mock, setDefaultTimeout, test } from "bun:test"

// The first import of ./route pulls auth-guard's transitive Supabase/drizzle
// graph in cold; module compile cost, not the code under test.
setDefaultTimeout(20000)

process.env.APP_RUNTIME_DATABASE_URL ??= "postgres://app_runtime:not-a-real-password@127.0.0.1:5432/test"

type Health = Awaited<ReturnType<typeof import("@/lib/db/tenant-scoped").readAppRuntimePoolHealth>>

function health(overrides: Partial<Health> = {}): Health {
  return {
    role: "app_runtime",
    database: "postgres",
    maxPoolSize: 5,
    active: 1,
    idle: 4,
    idleInTransaction: 0,
    idleInTransactionAborted: 0,
    other: 0,
    total: 5,
    oldestIdleInTransactionSeconds: null,
    idleInTransactionTimeoutMs: 30_000,
    sampledAt: "2026-09-03T10:00:00.000Z",
    ...overrides,
  }
}

let readAppRuntimePoolHealth = mock(async () => health())

async function mockDeps(options: { role: string | null; reader?: () => Promise<Health> }) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    // requireRole is deliberately NOT mocked -- the real rank check runs.
    requireAuth: mock(async () => ({
      response: null,
      user: null,
      dbUser: options.role === null ? null : { role: options.role },
      orgId: "org-1",
    })),
  }))

  readAppRuntimePoolHealth = mock(options.reader ?? (async () => health()))
  const dbActual = await import("@/lib/db/tenant-scoped")
  mock.module("@/lib/db/tenant-scoped", () => ({ ...dbActual, readAppRuntimePoolHealth }))
}

beforeEach(() => {
  readAppRuntimePoolHealth = mock(async () => health())
})

describe("GET /api/internal/pool-health: it is never public", () => {
  test("a member is refused -- the real requireRole rank check runs", async () => {
    await mockDeps({ role: "member" })
    const { GET } = await import("./route")

    const response = await GET()

    expect(response.status).toBe(403)
    // And nothing was read: the gate is before the probe, not after it.
    expect(readAppRuntimePoolHealth).not.toHaveBeenCalled()
  })

  test("a manager is refused too -- this is admin, not 'senior enough'", async () => {
    await mockDeps({ role: "manager" })
    const { GET } = await import("./route")

    expect((await GET()).status).toBe(403)
  })

  test("an admin is allowed", async () => {
    await mockDeps({ role: "admin" })
    const { GET } = await import("./route")

    const response = await GET()

    expect(response.status).toBe(200)
    expect(readAppRuntimePoolHealth).toHaveBeenCalledTimes(1)
  })
})

describe("GET /api/internal/pool-health: the verdict", () => {
  async function verdictFor(overrides: Partial<Health>) {
    await mockDeps({ role: "admin", reader: async () => health(overrides) })
    const { GET } = await import("./route")
    const body = await (await GET()).json()
    return body as { status: string; pool: Health }
  }

  test("no idle-in-transaction sessions reads healthy", async () => {
    expect((await verdictFor({ idleInTransaction: 0 })).status).toBe("healthy")
  })

  test("some, but not the whole pool, is reported rather than alarmed about", async () => {
    expect((await verdictFor({ idleInTransaction: 2, oldestIdleInTransactionSeconds: 3 })).status)
      .toBe("idle_in_transaction_present")
  })

  test("enough to occupy the client-side pool is 'saturated' -- the shape of the real incident", async () => {
    expect((await verdictFor({ idleInTransaction: 5, oldestIdleInTransactionSeconds: 12 })).status)
      .toBe("saturated")
  })

  test("a `total` above maxPoolSize does NOT on its own mean saturated", async () => {
    // Through Supabase's transaction pooler `total` counts every instance's
    // sessions, so a total-based verdict would cry wolf on a healthy fleet.
    expect((await verdictFor({ total: 40, idle: 39, active: 1, idleInTransaction: 0 })).status).toBe("healthy")
  })

  test("a session idling far longer than the 30 s net means the net is not reaching it", async () => {
    const body = await verdictFor({ idleInTransaction: 1, oldestIdleInTransactionSeconds: 1523 })

    expect(body.status).toBe("net_not_reaching")
    expect(body.pool.idleInTransactionTimeoutMs).toBe(30_000)
  })

  test("the counts are returned as measured, not summarised away", async () => {
    const body = await verdictFor({ active: 2, idle: 1, idleInTransaction: 1, idleInTransactionAborted: 1, other: 0, total: 5 })

    expect(body.pool.active).toBe(2)
    expect(body.pool.idleInTransaction).toBe(1)
    expect(body.pool.idleInTransactionAborted).toBe(1)
    expect(body.pool.maxPoolSize).toBe(5)
  })
})

describe("GET /api/internal/pool-health: failure", () => {
  test("a failed probe is a 500 with a real message, not a fabricated healthy reading", async () => {
    await mockDeps({ role: "admin", reader: async () => { throw new Error("connection refused") } })
    const { GET } = await import("./route")

    const response = await GET()

    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe("Failed to read app_runtime pool health")
  })
})
