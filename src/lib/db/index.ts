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
let client: ReturnType<typeof postgres> | null = null
function getClient() {
  if (!client) {
    client = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      max: 1,
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
