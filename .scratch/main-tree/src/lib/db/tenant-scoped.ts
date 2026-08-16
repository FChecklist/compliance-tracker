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

let client: ReturnType<typeof postgres> | null = null
function getClient() {
  if (!client) {
    client = postgres(getAppRuntimeConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      max: 5,
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
  const db = getRawDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${context.orgId}, true)`)
    if (context.clientIds && context.clientIds.length > 0) {
      await tx.execute(sql`SELECT set_config('app.current_client_ids', ${context.clientIds.join(",")}, true)`)
    }
    if (context.userId) {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${context.userId}, true)`)
    }
    return fn(tx)
  })
}

export * from "./schema"
