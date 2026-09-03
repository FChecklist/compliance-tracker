/// <reference types="bun-types" />
// R67 F-12 / F-15 (R-192 / R-216 / R-232 / R-251), programme decision D-06 --
// sibling test for the nested-transaction guard.
//
// THE FAULT. tenant-scoped.ts's pool is `max: 5` for the whole application. A
// function that opens a tenant transaction and then calls another function that
// opens its own holds two of those five connections at once, and the second is
// only obtainable if a slot is free. On 2026-09-02 that self-deadlocked
// production: pg_stat_activity showed all five app_runtime sessions "idle in
// transaction" for 25 minutes, parked on getProjectDashboard() ->
// earnedValueReport() -> requireConstructionEnabled(). Every one of those
// functions is correct on its own; the combination is not. The guard makes that
// rule mechanical instead of a thing reviewers have to remember.
//
// HOW THIS TESTS IT WITHOUT A DATABASE. The postgres driver and drizzle's
// constructor are mocked, so the transaction "runs" in memory. That is enough,
// because the guard is decided before any connection is taken -- which is
// itself the point: a nested call must be rejected without first queueing for
// the pool it is about to exhaust.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// Set before the module under test is imported: getAppRuntimeConnectionString()
// throws without it. The value is never dialled -- the driver below is a stub.
process.env.APP_RUNTIME_DATABASE_URL = "postgres://app_runtime:not-a-real-password@127.0.0.1:5432/test"

const executed: string[] = []
const fakeTx = {
  execute: async (query: unknown) => {
    executed.push(String((query as { queryChunks?: unknown })?.queryChunks ? "set_config" : query))
    return []
  },
}

let openTransactions = 0
let maxConcurrentTransactions = 0
let postgresOptions: Record<string, unknown> | undefined

await mock.module("postgres", () => ({
  default: (_url: string, options: Record<string, unknown>) => {
    postgresOptions = options
    return {}
  },
}))

// R67 F-16: readAppRuntimePoolHealth() reads pg_stat_activity through the raw
// handle (never a transaction -- opening one to measure transactions would
// consume a slot it is reporting on), so the stub needs an `execute` too.
let poolHealthRows: Record<string, unknown>[] = []
const executedRaw: string[] = []

await mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: () => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      openTransactions += 1
      maxConcurrentTransactions = Math.max(maxConcurrentTransactions, openTransactions)
      try {
        return await fn(fakeTx)
      } finally {
        openTransactions -= 1
      }
    },
    execute: async (query: { queryChunks?: unknown[] }) => {
      executedRaw.push((query.queryChunks ?? []).map((c) => String((c as { value?: unknown })?.value ?? c)).join(""))
      return poolHealthRows
    },
  }),
}))

const {
  withTenantContext,
  isInsideTenantContext,
  assertNotNested,
  appRuntimePoolOptions,
  extractRouteFromStack,
  reportIdleTransactionTermination,
  readAppRuntimePoolHealth,
  IDLE_IN_TRANSACTION_SQLSTATE,
  IDLE_IN_TRANSACTION_TIMEOUT_MS,
} = await import("./tenant-scoped")

const CTX = { orgId: "org-1" }

beforeEach(() => {
  executed.length = 0
  openTransactions = 0
  maxConcurrentTransactions = 0
})

afterEach(() => {
  process.env.NODE_ENV = "test"
})

describe("withTenantContext: the D-06 nesting guard", () => {
  test("a single-level call still resolves, and sets the org GUC", async () => {
    const result = await withTenantContext(CTX, async () => "ok")

    expect(result).toBe("ok")
    expect(executed.length).toBeGreaterThan(0)
    expect(maxConcurrentTransactions).toBe(1)
  })

  test("entering it from inside its own callback rejects with 'nested withTenantContext'", async () => {
    expect(process.env.NODE_ENV).toBe("test")

    await expect(
      withTenantContext(CTX, async () => {
        return withTenantContext(CTX, async () => "inner")
      })
    ).rejects.toThrow(/nested withTenantContext/)
  })

  test("the rejection names both orgs and says what to do instead", async () => {
    let message = ""
    try {
      await withTenantContext({ orgId: "outer-org" }, async () => {
        return withTenantContext({ orgId: "inner-org" }, async () => "inner")
      })
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }

    expect(message).toContain("outer-org")
    expect(message).toContain("inner-org")
    expect(message).toContain("Pass the open transaction's db handle down")
  })

  test("the second transaction is never opened -- the guard runs before a connection is taken", async () => {
    await expect(
      withTenantContext(CTX, async () => withTenantContext(CTX, async () => "inner"))
    ).rejects.toThrow(/nested withTenantContext/)

    // One and only one transaction was ever opened by that call.
    expect(maxConcurrentTransactions).toBe(1)
  })

  test("two SEQUENTIAL calls are fine -- the flag is released when the transaction ends", async () => {
    await withTenantContext(CTX, async () => "first")
    await expect(withTenantContext(CTX, async () => "second")).resolves.toBe("second")
  })

  test("the flag is released even when the callback throws", async () => {
    await expect(withTenantContext(CTX, async () => { throw new Error("boom") })).rejects.toThrow("boom")
    await expect(withTenantContext(CTX, async () => "after")).resolves.toBe("after")
  })

  test("two CONCURRENT top-level calls are not nesting -- a module-level boolean would have failed this", async () => {
    // The exact false positive AsyncLocalStorage exists to avoid: two requests
    // interleaving on one Node process, each perfectly flat.
    const both = await Promise.all([
      withTenantContext({ orgId: "org-a" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return "a"
      }),
      withTenantContext({ orgId: "org-b" }, async () => "b"),
    ])

    expect(both).toEqual(["a", "b"])
  })

  test("isInsideTenantContext() reports the truth, in and out", async () => {
    expect(isInsideTenantContext()).toBe(false)
    const inside = await withTenantContext(CTX, async () => isInsideTenantContext())
    expect(inside).toBe(true)
    expect(isInsideTenantContext()).toBe(false)
  })
})

describe("withTenantContext: production warns instead of throwing", () => {
  test("nesting in production logs both stacks at warn level and lets the request finish", async () => {
    const warnings: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")) }
    process.env.NODE_ENV = "production"

    try {
      const result = await withTenantContext(CTX, async () => withTenantContext(CTX, async () => "inner"))
      expect(result).toBe("inner")
    } finally {
      console.warn = realWarn
      process.env.NODE_ENV = "test"
    }

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("nested withTenantContext")
    expect(warnings[0]).toContain("Outer transaction opened at:")
    expect(warnings[0]).toContain("Inner call from:")
  })
})

describe("assertNotNested", () => {
  test("outside any transaction it does nothing", () => {
    expect(() => assertNotNested({ orgId: "org-1" })).not.toThrow()
  })
})

describe("the app_runtime pool options this guard exists to protect", () => {
  test("still max 5, with the timeouts R46 added -- the guard is the fix, not a bigger pool", async () => {
    await withTenantContext(CTX, async () => "ok")

    expect(postgresOptions?.max).toBe(5)
    expect(postgresOptions?.connect_timeout).toBe(10)
    expect(postgresOptions?.idle_timeout).toBe(30)
    expect((postgresOptions?.connection as { statement_timeout?: number })?.statement_timeout).toBe(25_000)
  })
})

// R67 F-16 (R-233) -- the idle-in-transaction safety net and the pool probe.
describe("F-16: the 30 s idle-in-transaction safety net travels with the connection", () => {
  test("postgres() is given connection.options carrying the timeout as a -c startup option", async () => {
    // The real assertion of the item: the setting is in the application's own
    // connection, not only in the role the owner has already ALTERed. A role
    // setting is one `ALTER ROLE ... RESET ALL` from vanishing, and does not
    // exist at all on a developer's database.
    await withTenantContext(CTX, async () => "ok")

    const connection = postgresOptions?.connection as { options?: string; statement_timeout?: number } | undefined
    expect(connection?.options).toContain("-c idle_in_transaction_session_timeout=30000")
    // statement_timeout is a different axis (how long ONE QUERY may run) and is
    // not replaced by it -- a session parked idle in transaction is running no
    // query at all, which is why statement_timeout never caught this fault.
    expect(connection?.statement_timeout).toBe(25_000)
  })

  test("the exported options builder is the same object the client is built from", () => {
    const built = appRuntimePoolOptions()

    expect(built.max).toBe(5)
    expect(built.connection.options).toBe(`-c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`)
    expect(IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(30_000)
  })
})

describe("F-16: a transaction the server terminated is logged, not swallowed", () => {
  function captureWarnings(): { warnings: string[]; restore: () => void } {
    const warnings: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")) }
    return { warnings, restore: () => { console.warn = realWarn } }
  }

  test("a 25P03 failure inside withTenantContext warns with its SQL text, and still rejects", async () => {
    const { warnings, restore } = captureWarnings()

    // The exact shape postgres.js rejects with: a PostgresError carrying the
    // SQLSTATE, plus the statement that was in flight hung off `query`.
    const terminated = Object.assign(new Error("terminating connection due to idle-in-transaction timeout"), {
      code: IDLE_IN_TRANSACTION_SQLSTATE,
      query: "select id, name from compliance.projects where org_id = $1",
    })

    try {
      await expect(withTenantContext(CTX, async () => { throw terminated })).rejects.toThrow(
        "terminating connection due to idle-in-transaction timeout"
      )
    } finally {
      restore()
    }

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("25P03")
    expect(warnings[0]).toContain("select id, name from compliance.projects")
    expect(warnings[0]).toContain("route=")
  })

  test("an ordinary failure is not logged as a terminated transaction", async () => {
    const { warnings, restore } = captureWarnings()

    try {
      await expect(withTenantContext(CTX, async () => { throw new Error("a plain bug") })).rejects.toThrow("a plain bug")
    } finally {
      restore()
    }

    expect(warnings).toHaveLength(0)
  })

  test("reportIdleTransactionTermination says whether it recognised the error", () => {
    const { warnings, restore } = captureWarnings()
    let recognised = false
    let ignored = true

    try {
      recognised = reportIdleTransactionTermination(
        Object.assign(new Error("terminated"), { code: "25P03", query: "SELECT 1" }),
        "/api/v1/projexa/scope"
      )
      ignored = reportIdleTransactionTermination(Object.assign(new Error("nope"), { code: "23505" }), "/api/whatever")
    } finally {
      restore()
    }

    expect(recognised).toBe(true)
    expect(ignored).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("route=/api/v1/projexa/scope")
  })

  test("a driver that reports no SQL text still produces a usable line", () => {
    const { warnings, restore } = captureWarnings()
    try {
      reportIdleTransactionTermination(Object.assign(new Error("terminated"), { code: "25P03" }), null)
    } finally {
      restore()
    }

    expect(warnings[0]).toContain("(the driver reported no SQL text)")
    expect(warnings[0]).toContain("route=unknown")
  })
})

describe("F-16: extractRouteFromStack", () => {
  test("finds the route from a dev/source stack frame", () => {
    const stack = [
      "    at listBoqs (C:\\ct\\ct\\src\\lib\\services\\construction-boq-service.ts:401:12)",
      "    at GET (C:\\ct\\ct\\src\\app\\api\\v1\\construction\\boq\\route.ts:26:20)",
    ].join("\n")

    expect(extractRouteFromStack(stack)).toBe("/api/v1/construction/boq")
  })

  test("finds it in a compiled Next build stack too, where the file is route.js", () => {
    const stack = "    at m (/var/task/.next/server/app/api/v1/projexa/permits/route.js:1:2345)"

    expect(extractRouteFromStack(stack)).toBe("/api/v1/projexa/permits")
  })

  test("drops route groups, which are directory names and never part of a URL", () => {
    const stack = "    at GET (/repo/src/app/api/(internal)/pool-health/route.ts:9:1)"

    expect(extractRouteFromStack(stack)).toBe("/api/pool-health")
  })

  test("returns null rather than inventing a route when no handler frame is present", () => {
    expect(extractRouteFromStack("    at someScript (/repo/scripts/backfill.mjs:3:1)")).toBeNull()
    expect(extractRouteFromStack("")).toBeNull()
  })
})

describe("F-16: readAppRuntimePoolHealth", () => {
  test("reports the pg_stat_activity breakdown for app_runtime's own sessions", async () => {
    poolHealthRows = [{
      role_name: "app_runtime",
      database_name: "postgres",
      // postgres.js returns bigint counts as strings -- the real shape, not a
      // convenience.
      active: "1",
      idle: "2",
      idle_in_transaction: "2",
      idle_in_transaction_aborted: "0",
      total: "5",
      oldest_idle_in_transaction_seconds: "1523.4",
    }]

    const health = await readAppRuntimePoolHealth()

    expect(health.role).toBe("app_runtime")
    expect(health.active).toBe(1)
    expect(health.idle).toBe(2)
    expect(health.idleInTransaction).toBe(2)
    expect(health.total).toBe(5)
    expect(health.maxPoolSize).toBe(5)
    expect(health.oldestIdleInTransactionSeconds).toBeCloseTo(1523.4)
    expect(health.idleInTransactionTimeoutMs).toBe(30_000)
  })

  test("it does not open a transaction to measure transactions", async () => {
    poolHealthRows = [{ role_name: "app_runtime", database_name: "postgres", active: "0", idle: "0", idle_in_transaction: "0", idle_in_transaction_aborted: "0", total: "0", oldest_idle_in_transaction_seconds: null }]
    executedRaw.length = 0

    await readAppRuntimePoolHealth()

    expect(maxConcurrentTransactions).toBe(0)
    expect(executedRaw.join(" ")).toContain("pg_stat_activity")
  })

  test("states Postgres reports that this probe does not name are still counted, so the parts add up", async () => {
    poolHealthRows = [{
      role_name: "app_runtime",
      database_name: "postgres",
      active: "1",
      idle: "1",
      idle_in_transaction: "0",
      idle_in_transaction_aborted: "0",
      total: "3",
      oldest_idle_in_transaction_seconds: null,
    }]

    const health = await readAppRuntimePoolHealth()

    expect(health.other).toBe(1)
    expect(health.active + health.idle + health.idleInTransaction + health.idleInTransactionAborted + health.other).toBe(health.total)
    expect(health.oldestIdleInTransactionSeconds).toBeNull()
  })
})
