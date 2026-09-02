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
  }),
}))

const { withTenantContext, isInsideTenantContext, assertNotNested } = await import("./tenant-scoped")

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
