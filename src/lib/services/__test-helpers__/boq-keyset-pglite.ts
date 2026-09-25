// PROJEXA-BUILD-001 U-27 (BR-403, BR-404, BR-405): the database double shared by
// construction-boq-service.keyset.test.ts and src/app/api/v1/construction/boq/route.d11.test.ts.
//
// WHY PGLITE AND NOT A HAND-WRITTEN FAKE. The thing under test is a SQL keyset read: (boq_id COLLATE "C", id COLLATE
// "C") > ($1, $2), ORDER BY the same, LIMIT n + 1. A JavaScript fake would only replay this file's own idea of what
// that SQL does. PGlite is real Postgres compiled to WASM, in process and in memory (no server, no network, no live
// database), already used by the migration tests under src/. The real service code runs its real statements through
// drizzle-orm's PGlite driver; only withTenantContext is replaced, by withTenantContextDouble below, which opens a
// real PGlite transaction per call and throws on nesting (the five-connection-pool rule the real one guards).
//
// SCHEMA. The two BOQ tables come from scripts/verify/fixtures/0618_build001_projexa_gateway.base.sql, a schema-only
// snapshot of the live catalog (pcrjmlpuqsbocqfwoxod, generated 2026-09-25 by scripts/verify/gen-base-snapshot.mjs).
// compliance.boq_baseline is not in that snapshot; the minimal copy below follows schema.ts so getBoq()'s baseline
// lookup reads an empty table instead of failing.
//
// QUERY LOG. Every statement the service sends is recorded with the number of rows it returned, so a test can prove
// what the database was asked for (the keyset read returned at most limit + 1 rows), not only what the response held.
import { readFileSync } from "node:fs"
import { PGlite, type QueryOptions, type Transaction } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import * as schema from "@/lib/db/schema"

const REPO_ROOT = new URL("../../../../", import.meta.url)
const BASE_SNAPSHOT = "scripts/verify/fixtures/0618_build001_projexa_gateway.base.sql"

// The roles the snapshot's policies and grants name; PGlite's own superuser runs the tests (it bypasses RLS, which
// withTenantContext would otherwise scope with app.current_org_id).
const ROLES_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE app_runtime NOLOGIN;
`

const BOQ_BASELINE_SQL = `
CREATE TABLE compliance.boq_baseline (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  boq_id text NOT NULL,
  version integer NOT NULL,
  confirmed_by_id text NOT NULL,
  confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
  evidence_artefact_ref text NOT NULL,
  line_snapshot jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
`

export type QueryLogEntry = { sql: string; rows: number }

function recording(client: Pick<PGlite, "query"> | Pick<Transaction, "query">, log: QueryLogEntry[]) {
  return {
    query: async (sql: string, params?: any[], options?: QueryOptions) => {
      const result = await client.query(sql, params, options)
      log.push({ sql, rows: result.rows.length })
      return result
    },
  }
}

export async function createBoqPglite() {
  const pg = new PGlite()
  await pg.exec(ROLES_SQL)
  await pg.exec("SET TIME ZONE 'UTC'")
  await pg.exec(readFileSync(new URL(BASE_SNAPSHOT, REPO_ROOT), "utf8"))
  await pg.exec(BOQ_BASELINE_SQL)

  const queryLog: QueryLogEntry[] = []
  const client = {
    ...recording(pg, queryLog),
    transaction: <R>(fn: (tx: unknown) => Promise<R>) => pg.transaction((tx) => fn(recording(tx, queryLog))),
  }
  const db = drizzle({ client: client as unknown as PGlite, schema })

  const stats = { calls: 0, depth: 0, maxDepth: 0 }
  /** Stands in for @/lib/db/tenant-scoped's withTenantContext: one real PGlite transaction per call, never nested. */
  async function withTenantContextDouble<T>(_ctx: unknown, fn: (tx: any) => Promise<T>): Promise<T> {
    if (stats.depth > 0) throw new Error("nested withTenantContext (the real one refuses this too)")
    stats.calls++
    stats.depth++
    stats.maxDepth = Math.max(stats.maxDepth, stats.depth)
    try {
      return await db.transaction((tx) => fn(tx))
    } finally {
      stats.depth--
    }
  }

  return { pg, db, queryLog, stats, withTenantContextDouble }
}

/** Inserts rows (snake_case keys, one object per row) in chunks through json_populate_recordset. */
export async function insertRows(pg: PGlite, table: "construction_boqs" | "construction_boq_line_items", rows: Record<string, unknown>[]) {
  for (let start = 0; start < rows.length; start += 2000) {
    await pg.query(
      `insert into compliance.${table} select * from json_populate_recordset(null::compliance.${table}, $1::json)`,
      [JSON.stringify(rows.slice(start, start + 2000))]
    )
  }
}

/** Deterministic pseudo-random numbers (mulberry32), so a fixture is the same on every run and every machine. */
export function seededRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A 24-character id in the cuid2 alphabet, like the live ids createId() mints. */
export function fakeCuid(random: () => number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = alphabet[Math.floor(random() * 26)]
  for (let k = 1; k < 24; k++) id += alphabet[Math.floor(random() * alphabet.length)]
  return id
}

export function boqRow(fields: { id: string; org_id: string; project_id: string; version?: number; parent_boq_id?: string | null; title?: string; status?: string; created_at: string }) {
  return {
    version: 1,
    parent_boq_id: null,
    title: `BOQ ${fields.id}`,
    status: "draft",
    created_by_id: "user-fixture",
    updated_at: fields.created_at,
    ...fields,
  }
}

export function lineRow(fields: { id: string; boq_id: string; org_id: string } & Record<string, unknown>) {
  return {
    description: "Supply and fix 12 mm gypsum board partition on GI frame",
    unit: "m2",
    quantity: "10",
    rate: "845",
    amount: "8450",
    created_at: "2026-09-17T00:00:00Z",
    budget_percentage: "25",
    ...fields,
  }
}
