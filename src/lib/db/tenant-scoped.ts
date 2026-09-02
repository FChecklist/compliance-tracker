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
// R67 F-16 (R-233) -- THE 30 s IDLE-IN-TRANSACTION SAFETY NET, CARRIED BY THE
// CONNECTION ITSELF.
//
// The nesting guard below stops the code that leaks connections from being
// written. This is the other half: what catches a transaction that is already
// open and stuck, whatever wrote it. `statement_timeout` does NOT cover that
// case -- it bounds how long one QUERY may run, and a session parked "idle in
// transaction" (BEGIN sent, a slow await in the callback, no query in flight)
// is running no query at all. That is exactly the state pg_stat_activity showed
// on all five app_runtime sessions for 25 minutes on 2026-09-02.
//
// The owner has already applied the role-level form to production
// (`ALTER ROLE app_runtime SET idle_in_transaction_session_timeout = '30s'` on
// pcrjmlpuqsbocqfwoxod, verified via pg_roles -- see decisions.md's D-06
// amendment). This is deliberately NOT a duplicate of it: a role setting is one
// `ALTER ROLE ... RESET ALL` away from silently disappearing, and it does not
// exist at all on a developer's own database or on any future project the app
// is pointed at. Sending it as a startup option means the guarantee travels
// with the application, and the two agree on the same 30 s.
//
// WHY `connection.options` AND NOT A PLAIN `connection` KEY. postgres.js sends
// every `connection` entry as a startup parameter;
// `idle_in_transaction_session_timeout` is settable that way too, but `options`
// (`-c name=value`, the libpq form) is the one Postgres has always accepted for
// arbitrary GUCs and the one this item specifies. `statement_timeout` stays a
// plain key -- it is already deployed in that form and works through Supabase's
// pooler, so it is not moved here on the way past. If a pooler upgrade ever
// rejected the `options` packet the symptom would be a connection failure at
// startup, not a slow query, and the rollback is this one line.
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000

/** The `-c` startup option carrying the safety net above. */
export const APP_RUNTIME_STARTUP_OPTIONS = `-c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`

/**
 * The exact options object handed to postgres() for the app_runtime pool.
 * Exported so the sibling test can assert on it without dialling a database --
 * every value here is a production incident's fix (R46's timeouts, R67 F-16's
 * idle-in-transaction net) and none of them should be able to disappear
 * unnoticed.
 */
export function appRuntimePoolOptions() {
  return {
    prepare: false,
    ssl: { rejectUnauthorized: false },
    // Not raised by R67: the pool is only re-measured once the leak is gone
    // (D-06's own rule). More connections would only leak faster.
    max: 5,
    connect_timeout: 10,
    idle_timeout: 30,
    connection: {
      statement_timeout: 25_000,
      options: APP_RUNTIME_STARTUP_OPTIONS,
    },
  }
}

let client: ReturnType<typeof postgres> | null = null
function getClient() {
  if (!client) {
    client = postgres(getAppRuntimeConnectionString(), appRuntimePoolOptions())
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

// R67 F-16 (R-233) -- MAKE A TERMINATED TRANSACTION VISIBLE.
//
// With the timeout above in force, a transaction that sits idle for 30 s is
// killed by the server. The application sees an ordinary rejected promise with
// SQLSTATE 25P03 ("idle_in_transaction_session_timeout"), which every route's
// own catch turns into its generic 500 -- so the safety net would do its job
// and leave no trace of having done it, and the next investigator would be
// looking at "a 500 on /api/v1/projexa/scope" with nothing connecting it to a
// pool problem. This logs the pair of facts that identify it: the SQL that was
// in flight, and the route the transaction was opened from.
export const IDLE_IN_TRANSACTION_SQLSTATE = "25P03"

// The route is recovered from the stack captured when the transaction opened,
// rather than threaded through every caller: withTenantContext takes a context,
// not a Request, and 900-odd call sites would have to pass one. Next compiles a
// route handler to `<...>/app/api/<segments>/route.js`, and the dev/test source
// path is `src/app/api/<segments>/route.ts`, so the same pattern finds both.
// Route groups -- `(app)`, `(marketing)` -- are directory names only and never
// appear in a URL, so they are dropped.
const ROUTE_FRAME_RE = /[\\/]app[\\/]api[\\/](.+?)[\\/]route\.(?:ts|tsx|js|mjs|cjs)/

export function extractRouteFromStack(stack: string): string | null {
  const match = ROUTE_FRAME_RE.exec(stack)
  if (!match) return null
  const segments = match[1]
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0 && !(segment.startsWith("(") && segment.endsWith(")")))
  if (segments.length === 0) return null
  return `/api/${segments.join("/")}`
}

/**
 * Warns when `error` is a transaction the server terminated for sitting idle.
 * Returns true when it logged, so the caller (and the test) can tell a
 * recognised 25P03 from every other failure. Never throws and never swallows:
 * the error itself is always re-thrown by the caller.
 */
export function reportIdleTransactionTermination(error: unknown, route: string | null): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (code !== IDLE_IN_TRANSACTION_SQLSTATE) return false

  // postgres.js hangs the query text off the rejected error as a non-enumerable
  // `query` property (see its Query error path). It is the statement that was
  // in flight when the backend was killed -- which is what says WHERE the
  // transaction was parked, not just that it was.
  const raw = (error as { query?: unknown }).query
  const sqlText = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "(the driver reported no SQL text)"
  const message = error instanceof Error ? error.message : String(error)

  console.warn(
    `[tenant-scoped] ${IDLE_IN_TRANSACTION_SQLSTATE} idle_in_transaction_session_timeout: the server terminated this ` +
      `transaction after ${IDLE_IN_TRANSACTION_TIMEOUT_MS}ms idle. route=${route ?? "unknown"} sql=${sqlText} driver=${message}`
  )
  return true
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
  const stack = captureStack()
  return tenantTransactionStore.run({ orgId: context.orgId, enteredAt: new Date().toISOString(), stack }, async () => {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_org_id', ${context.orgId}, true)`)
        if (context.clientIds && context.clientIds.length > 0) {
          await tx.execute(sql`SELECT set_config('app.current_client_ids', ${context.clientIds.join(",")}, true)`)
        }
        if (context.userId) {
          await tx.execute(sql`SELECT set_config('app.current_user_id', ${context.userId}, true)`)
        }
        return fn(tx)
      })
    } catch (error) {
      // R67 F-16: log-and-rethrow only. The caller's own error handling is
      // unchanged -- this exists so a transaction the server killed for idling
      // is identifiable in the compliance-tracker log instead of arriving at
      // the route as an anonymous failure.
      reportIdleTransactionTermination(error, extractRouteFromStack(stack))
      throw error
    }
  })
}

// R67 F-16 (R-233) -- THE POOL PROBE.
//
// During the 2026-09-02 incident the only way to see the pool's state was to
// open a Supabase SQL session by hand and run pg_stat_activity -- which meant
// the fault was invisible until someone already suspected it. This turns that
// ad-hoc janitor query into a permanent, admin-only endpoint
// (GET /api/internal/pool-health).
//
// It reads through THIS pool on purpose. pg_stat_activity hides other roles'
// session details from a non-superuser -- `state` comes back NULL for a backend
// belonging to a role the caller is not a member of -- so a probe running as
// any other role would report the sessions but not what they are doing. Running
// as app_runtime, these are its OWN sessions and every column is real.
//
// It also deliberately does NOT go through withTenantContext: it reads a
// catalog view, not tenant data (no RLS applies), and opening a transaction to
// measure transactions would consume one of the five slots it is reporting on.
//
// READ THE NUMBERS CORRECTLY. `maxPoolSize` is THIS instance's client-side cap;
// the counts are every app_runtime session the database currently has, which
// through Supabase's transaction pooler can span several serverless instances.
// So `total` legitimately exceeds `maxPoolSize`, and that on its own is normal.
// The number that mattered in the incident is `idleInTransaction`, and above
// all `oldestIdleInTransactionSeconds`: with the 30 s net in force, anything
// materially older than 30 s means the net is not reaching that session.
export type AppRuntimePoolHealth = {
  role: string
  database: string
  maxPoolSize: number
  active: number
  idle: number
  idleInTransaction: number
  idleInTransactionAborted: number
  other: number
  total: number
  /** Age of the longest-running idle-in-transaction session, or null if none. */
  oldestIdleInTransactionSeconds: number | null
  idleInTransactionTimeoutMs: number
  sampledAt: string
}

type PoolHealthRow = {
  role_name: string | null
  database_name: string | null
  active: string | number | null
  idle: string | number | null
  idle_in_transaction: string | number | null
  idle_in_transaction_aborted: string | number | null
  total: string | number | null
  oldest_idle_in_transaction_seconds: string | number | null
}

function toCount(value: string | number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function readAppRuntimePoolHealth(): Promise<AppRuntimePoolHealth> {
  const rows = (await getRawDb().execute(sql`
    SELECT
      current_user::text AS role_name,
      current_database()::text AS database_name,
      count(*) FILTER (WHERE state = 'active') AS active,
      count(*) FILTER (WHERE state = 'idle') AS idle,
      count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction,
      count(*) FILTER (WHERE state = 'idle in transaction (aborted)') AS idle_in_transaction_aborted,
      count(*) AS total,
      max(extract(epoch FROM (now() - state_change)))
        FILTER (WHERE state LIKE 'idle in transaction%') AS oldest_idle_in_transaction_seconds
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = current_user
  `)) as unknown as PoolHealthRow[]

  const row = rows?.[0]
  const active = toCount(row?.active)
  const idle = toCount(row?.idle)
  const idleInTransaction = toCount(row?.idle_in_transaction)
  const idleInTransactionAborted = toCount(row?.idle_in_transaction_aborted)
  const total = toCount(row?.total)
  const oldest = row?.oldest_idle_in_transaction_seconds

  return {
    role: row?.role_name ?? "unknown",
    database: row?.database_name ?? "unknown",
    maxPoolSize: appRuntimePoolOptions().max,
    active,
    idle,
    idleInTransaction,
    idleInTransactionAborted,
    // Anything Postgres reports in a state this probe does not name (e.g.
    // 'fastpath function call', or NULL for a background worker) still has to
    // be counted somewhere, or the parts would silently not add up to `total`.
    other: Math.max(0, total - active - idle - idleInTransaction - idleInTransactionAborted),
    total,
    oldestIdleInTransactionSeconds: oldest === null || oldest === undefined ? null : Number(oldest),
    idleInTransactionTimeoutMs: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    sampledAt: new Date().toISOString(),
  }
}

export * from "./schema"
