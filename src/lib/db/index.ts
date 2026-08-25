import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { getConnectionString } from './connection-string'

// Lazy, same pattern as tenant-scoped.ts's getClient()/getRawDb() -- opening
// the connection eagerly at module-evaluation time meant that any file
// merely importing a schema table from here (e.g. `import { users } from
// "@/lib/db"`, needed just for a `where eq(...)` clause) also opened a real
// Postgres connection as a side effect, even on routes whose actual query
// runs through the already-lazy withTenantContext. That turned a missing
// DATABASE_URL into a crash on import rather than on first real use, and in
// Turbopack dev this forced a full module-graph re-evaluation on every
// request touching any of those files.
// R46 (production incident, 2026-08-25: "Vercel Runtime Timeout Error: Task
// timed out after 300 seconds", 138 occurrences across 18 real users,
// CHRONIC since 2026-07-15, spanning ~19 unrelated /api/v1/projexa/* routes
// simultaneously -- /dashboard, /scope, /customers, /module-chain, /assistant,
// etc). None of connect_timeout/idle_timeout/statement_timeout were ever
// set, so a single slow or stuck query on this max:1 (one connection per
// warm Lambda instance) client had nothing to time it out at the DB-client
// or DB-server level -- it could ride all the way to Vercel's own 300s
// function cap, and since `max: 1` means every request sharing that warm
// instance serializes on the ONE connection, one hung query blocked every
// OTHER route's request behind it too, which is exactly the "many
// unrelated routes fail together" pattern the incident telemetry showed.
// This does not change `max` (a separate, larger tradeoff against
// Supabase's own connection-count limits, not addressed here) -- it only
// bounds how long any single connect/query can occupy the one connection,
// so a hang now fails fast (with a clear Postgres/postgres.js timeout
// error) instead of consuming the full 300s Vercel limit and blocking
// every other request queued behind it.
let client: ReturnType<typeof postgres> | null = null
function getClient() {
  if (!client) {
    client = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connect_timeout: 10,
      idle_timeout: 30,
      connection: { statement_timeout: 25_000 },
    })
  }
  return client
}

type Db = ReturnType<typeof drizzle<typeof schema>>
let rawDb: Db | null = null
function getDb(): Db {
  if (!rawDb) rawDb = drizzle(getClient(), { schema })
  return rawDb
}

// Proxies every property access through to the lazily-constructed client, so
// existing call sites (`db.query.x`, `db.select()`, `db.transaction(...)`)
// are untouched -- only the first actual access triggers a connection.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver)
  },
}) as Db

export * from './schema'
