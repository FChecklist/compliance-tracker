import { AsyncLocalStorage } from "node:async_hooks"
import { drizzle } from "drizzle-orm/postgres-js"
import { sql } from "drizzle-orm"
import postgres from "postgres"
import * as schema from "./schema"

// Dedicated connection for the running app, using the `app_runtime` Postgres
// role (no RLS bypass -- unlike `postgres`, which DATABASE_URL still uses for
// routes not yet migrated to this wrapper). Real tenant isolation depends on
// every query running through this client, inside withTenantContext.
function getAppRuntimeConnectionString(): string {
  if (process.env.APP_RUNTIME_DATABASE_URL) return process.env.APP_RUNTIME_DATABASE_URL
  throw new Error(
    "APP_RUNTIME_DATABASE_URL is not set. This must point at the app_runtime role, not the postgres role -- see orchestra_changes.md Wave 1."
  )
}

// R46 (production incident, 2026-08-25: "Vercel Runtime Timeout Error: Task
// timed out after 300 seconds", 138 occurrences / 18 real users, chronic
// since 2026-07-15, across ~19 unrelated routes -- see db/index.ts's sibling
// comment for the full writeup). This is the client "every query running
// through withTenantContext" actually uses (per this file's own header
// comment) -- i.e. the real tenant-scoped path most of the affected routes
// go through -- and it had the identical gap: no connect_timeout,
// idle_timeout, or statement_timeout, so a single slow/stuck query could
// occupy one of only 5 connections indefinitely, up to Vercel's own 300s
// cap. Same fix as db/index.ts, same reasoning: bounds exposure, does not
// change `max` (a separate, larger tradeoff not addressed here).
let client: ReturnType<typeof postgres> | null = null
function getClient() {
  if (!client) {
    client = postgres(getAppRuntimeConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      max: 5,
      connect_timeout: 10,
      idle_timeout: 30,
      connection: { statement_timeout: 25_000 },
    })
  }
  return client
}

let rawDb: ReturnType<typeof drizzle<typeof schema>> | null = null
function getRawDb() {
  if (!rawDb) {
    rawDb = drizzle(getClient(), { schema })
  }
  return rawDb
}

export type TenantContext = {
  orgId: string
  clientIds?: string[]
  userId?: string
}

// R67 F-12/F-15 (R-192/R-216/R-232/R-251), programme decision D-06 -- THE
// NESTED-TRANSACTION GUARD.
//
// THE FAULT IT CATCHES. `max: 5` above is the whole application's pool. A
// function that opens a tenant transaction and then, from inside it, calls
// another function that opens its own, holds TWO of those five connections for
// as long as the inner one runs -- and the second one is only obtainable if the
// pool has a free slot. Reproduced live on 2026-09-02: getProjectDashboard()
// (one connection) called earnedValueReport(), which called
// requireConstructionEnabled() -> isBranchEnabledForOrg() (a second and third),
// and pg_stat_activity showed all five app_runtime sessions "idle in
// transaction" for 25 minutes. Nothing in the code said this was illegal; every
// individual function was correct in isolation, which is exactly why it kept
// coming back (R43_MGR_01 removed one instance in August, another was still
// live in September). This makes the rule mechanical.
//
// WHY AsyncLocalStorage AND NOT A MODULE-LEVEL BOOLEAN. Requests interleave on
// one Node process: a plain flag set by request A would report "nested" for
// request B's perfectly flat call. AsyncLocalStorage is per async execution
// context, so the flag follows one call chain and only that one. This is the
// first use of it in this repo.
//
// WHAT IS ALREADY KNOWN TO NEST (audited 2026-09-02 while adding this, by
// matching every withTenantContext callback body against the exported functions
// that open one). The construction/dashboard/reports chain this programme owns
// is FLAT (R67 F-10/F-15 finished that), and these remain, in code this item
// does not own -- they are why the guard exists, and each needs the same
// treatment (pass the open handle down, or hoist the call above the
// transaction):
//   - erp-goods-receipt-service.ts submitPurchaseReceipt() -> recordStockReceipt()
//     (also a correctness problem: the stock ledger commits in a different
//     transaction from the receipt status it is posting for)
//   - erp-returns-service.ts and erp-inventory-planning-service.ts -> the same
//     recordStockReceipt() / recordStockIssue() / getItemValuation()
//   - erp-invoicing-service.ts / erp-payment-entries-service.ts -> isPeriodOpenForDate()
//   - construction-valuation-service.ts and erp-contract-service.ts -> createSalesInvoice()
//   - orchestra-execution-logger.ts recordOrchestraExecution(), called from
//     inside CRM / FM / meeting transactions. That one is fire-and-forget and
//     already swallows its own failures, so under this guard it degrades to a
//     skipped log line, not a failed request.
// This list is a snapshot, not a maintained registry: the guard itself is the
// live answer.
//
// WHY IT THROWS IN DEV AND TEST, AND ONLY WARNS IN PRODUCTION. Throwing is how
// a developer finds out, at the moment they write it, in the stack that caused
// it. In production the same throw would turn a slow page into a broken one --
// and nesting is a latency/exhaustion bug, not a correctness one: the query
// results are right, they just cost too much. So production logs both stacks
// (the outer transaction's and the inner call's) at warn level, with enough to
// find the pair, and lets the request finish.
type TenantTransactionFrame = { orgId: string; enteredAt: string; stack: string }

const tenantTransactionStore = new AsyncLocalStorage<TenantTransactionFrame>()

/** True while the caller is running inside a withTenantContext transaction. */
export function isInsideTenantContext(): boolean {
  return tenantTransactionStore.getStore() !== undefined
}

function captureStack(): string {
  // .stack includes this frame and withTenantContext's; both are noise.
  const raw = new Error("withTenantContext").stack ?? ""
  return raw.split("\n").slice(3).join("\n")
}

/**
 * Guard entry point. Exported for the sibling test, which needs to exercise the
 * decision without a database.
 */
export function assertNotNested(context: TenantContext): void {
  const open = tenantTransactionStore.getStore()
  if (!open) return

  const detail =
    `nested withTenantContext: a transaction for org ${open.orgId} (opened ${open.enteredAt}) is still open, ` +
    `and org ${context.orgId} tried to open a second one. Pass the open transaction's db handle down instead ` +
    `-- one request must never hold two of the five app_runtime connections (src/lib/db/tenant-scoped.ts).`

  // NODE_ENV is read per call, never captured at module load: bun test and next
  // dev both set it before importing, but a test that flips it must be able to
  // see the other branch.
  const env = process.env.NODE_ENV
  if (env === "development" || env === "test") {
    throw new Error(detail)
  }
  console.warn(`[tenant-scoped] ${detail}\nOuter transaction opened at:\n${open.stack}\nInner call from:\n${captureStack()}`)
}

export type TenantDb = Parameters<Parameters<ReturnType<typeof getRawDb>["transaction"]>[0]>[0]

/**
 * Runs `fn` inside a transaction scoped to `context` via Postgres GUCs
 * (`app.current_org_id`, `app.current_client_ids`, `app.current_user_id`),
 * read by the `compliance.current_org_id()` / `current_client_ids()` /
 * `current_user_id()` functions that the real RLS policies check.
 * `SET LOCAL x = $1` is invalid Postgres syntax -- SET does not accept bind
 * parameters, only literals (empirically confirmed: `PREPARE p(text) AS SET
 * LOCAL x = $1` throws `42601 syntax error at or near "SET"`). This means
 * every call through this function was throwing since it was introduced --
 * `set_config(name, value, is_local)` is the parameterizable equivalent
 * (third arg `true` == transaction-local, same reset-at-commit behavior as
 * SET LOCAL). Do not reintroduce the `SET LOCAL ${...}` form.
 *
 * Every query inside `fn` runs as `app_runtime`, which has no RLS bypass --
 * a forgotten `WHERE org_id = ...` in a route still gets filtered correctly.
 *
 * `userId` is required for Wave 2 (AI Assistants) routes, whose RLS
 * policies check `compliance.current_user_id()` -- without it, those
 * tables' queries return zero rows (fail-closed, not fail-open).
 */
export async function withTenantContext<T>(
  context: TenantContext,
  fn: (tx: TenantDb) => Promise<T>
): Promise<T> {
  assertNotNested(context)
  const db = getRawDb()
  return tenantTransactionStore.run({ orgId: context.orgId, enteredAt: new Date().toISOString(), stack: captureStack() }, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${context.orgId}, true)`)
      if (context.clientIds && context.clientIds.length > 0) {
        await tx.execute(sql`SELECT set_config('app.current_client_ids', ${context.clientIds.join(",")}, true)`)
      }
      if (context.userId) {
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${context.userId}, true)`)
      }
      return fn(tx)
    })
  )
}

export * from "./schema"
