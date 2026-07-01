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
}

export type TenantDb = Parameters<Parameters<ReturnType<typeof getRawDb>["transaction"]>[0]>[0]

/**
 * Runs `fn` inside a transaction scoped to `context` via Postgres GUCs
 * (`app.current_org_id`, `app.current_client_ids`), read by the
 * `compliance.current_org_id()` / `current_client_ids()` functions that the
 * real RLS policies check. `SET LOCAL` resets automatically at the end of
 * the transaction, so this is safe to reuse across pooled connections.
 *
 * Every query inside `fn` runs as `app_runtime`, which has no RLS bypass --
 * a forgotten `WHERE org_id = ...` in a route still gets filtered correctly.
 */
export async function withTenantContext<T>(
  context: TenantContext,
  fn: (tx: TenantDb) => Promise<T>
): Promise<T> {
  const db = getRawDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_org_id = ${context.orgId}`)
    if (context.clientIds && context.clientIds.length > 0) {
      await tx.execute(sql`SET LOCAL app.current_client_ids = ${context.clientIds.join(",")}`)
    }
    return fn(tx)
  })
}

export * from "./schema"
