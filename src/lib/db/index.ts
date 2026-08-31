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
//
// R43_EXEC_02 (this IS the "separate, larger tradeoff" the comment above
// deferred): intermittent 504s on member-role reads, reproduced live --
// get_runtime_errors on this project shows 16 "Task timed out after 300
// seconds" occurrences across 10 users specifically on
// /api/v1/projexa/vendors and /api/v1/projexa/employees, 2026-07-15 through
// 2026-08-25. Both routes call requireAuthOrApiKey() -> validateApiKey()
// (api-key-auth.ts), which runs entirely on THIS client -- the API-key
// lookup, the fire-and-forget lastUsedAt update, and the request-log
// insert. `max: 1` meant every one of those queries, from every
// concurrently-in-flight request sharing a warm Lambda instance (Fluid
// Compute keeps this module-level `client` singleton alive across
// concurrent invocations, not just across cold/warm boundaries), serialized
// onto the SAME one connection -- so a burst of ordinary concurrent traffic
// (PROJEXA alone fires ~6 API calls per page load, see veridian-client.ts)
// was enough to queue requests behind each other even with no query
// actually stuck. A queued request has no wait-for-a-free-connection
// timeout of its own in postgres.js -- it can wait the full
// statement_timeout (25s) behind whatever else is holding the connection --
// which lines up with the fault's observed ~21s/~36s 504s (PROJEXA's own
// 20s-per-attempt client timeout in veridian-client.ts firing while still
// queued here).
// Ruled out first: query plans on both routes already use indexed
// lookups (api_keys.key_hash is UNIQUE-indexed; users/employee_profiles/
// erp_suppliers all have an org_id index -- see drizzle/0004, 0030, 0043)
// and Supabase's own performance advisor reports zero missing-index/seq-
// scan findings for any of them -- this is concurrency contention on a
// single connection, not a slow query or a missing index.
// Fix: raise `max` from 1 to 5 -- matching tenant-scoped.ts's own
// already-deployed, already-safe value for a comparably hot, comparably
// tenant-request-driven client. Safe to raise: this connects through
// Supabase's transaction-mode pooler (port 6543 / Supavisor, see
// connection-string.ts), which multiplexes many client-side connections
// down to a small number of real Postgres backend connections by design --
// client-side `max` is not a 1:1 draw against the DB server's own
// max_connections (confirmed live at 60 on this project). Does not touch
// tenant-scoped.ts's pool (already at 5, not the outlier here) or any
// timeout value above (unrelated axis, already fixed by R46).
let client: ReturnType<typeof postgres> | null = null
function getClient() {
  if (!client) {
    client = postgres(getConnectionString(), {
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
