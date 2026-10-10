// PROJEXA-BUILD-001 U-46 step 1 (BR-483 to BR-489): the PGlite database the Universal AI Work Link migration tests share.
//
// PGlite is real Postgres compiled to WASM, in process and in memory: no server, no network, no live database. The database is
// built the way the live one is, in this order:
//   1. the roles Supabase provides, and the DEFAULT PRIVILEGES the live database has (pg_default_acl, read 2026-09-25): every new
//      function in schema public is executable by anon, authenticated and service_role, and every new table in schema platform is
//      readable and writable by service_role and app_runtime. They are reproduced so that the REVOKEs of the migrations are really
//      tested: without them a missing REVOKE would pass unnoticed.
//   2. the extension the functions use: pgcrypto in schema extensions (gen_random_bytes).
//   3. scripts/verify/fixtures/0625_build001_awl_read_functions.base.sql, a schema-only snapshot of the live tables the link
//      functions read (compliance.users, projects, the BOQ tables and the rest), written by scripts/verify/gen-base-snapshot.mjs.
//   4. the migration files 0621 to 0630, in number order, as far as the caller asks (`upTo`). A test written before 0629 asks for "0628"
//      and keeps the database it was written against; a test of the write path takes the default.
// PGlite's own superuser runs the statements, as postgres does live (it bypasses row-level security, like the live owner).
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

export const REPO_ROOT = new URL("../../../../", import.meta.url)
export const read = (rel: string) => readFileSync(new URL(rel, REPO_ROOT), "utf8")

export const AWL_MIGRATIONS = [
  "0621_build001_awl_config_tables",
  "0622_build001_awl_intent",
  "0623_build001_awl_call_log",
  "0624_build001_awl_link_functions",
  "0625_build001_awl_read_functions",
  "0626_build001_awl_intent_functions",
  "0627_build001_awl_retention",
  "0628_build001_awl_seed",
  // BUILD-002 WP-09a: the write path's SQL (claim, finish, draft state, live re-resolve) and the two provenance columns of submissions
  "0629_build001_awl_execution_sql",
  "0630_build001_awl_submissions_via",
] as const

export const forwardSql = (name: string) => read(`drizzle/${name}.sql`)
export const downSql = (name: string) => read(`drizzle/down/${name}.down.sql`)
export const BASE_SNAPSHOT_SQL = () => read("scripts/verify/fixtures/0625_build001_awl_read_functions.base.sql")

const ROLES_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE app_runtime NOLOGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, app_runtime;
`

export async function openAwlPglite(): Promise<PGlite> {
  const pg = await PGlite.create({ extensions: { pgcrypto } })
  await pg.exec("SET TIME ZONE 'UTC'")
  await pg.exec(ROLES_SQL)
  await pg.exec(BASE_SNAPSHOT_SQL())
  return pg
}

/** A database with migrations 0621 .. `upTo` (inclusive; a 4-digit prefix such as "0624") applied. The default is the newest, 0630. */
export async function createAwlDb(upTo: string = "0630"): Promise<PGlite> {
  const pg = await openAwlPglite()
  for (const name of AWL_MIGRATIONS) {
    if (name.slice(0, 4) > upTo) break
    await pg.exec(forwardSql(name))
  }
  return pg
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params)
  return r.rows[0]
}

/** The error text of a statement that must fail, or "" when it did not fail. */
export async function failure(db: PGlite, sql: string, params: unknown[] = []): Promise<{ message: string; code: string }> {
  try {
    await db.query(sql, params)
    return { message: "", code: "" }
  } catch (e) {
    const err = e as { message?: string; code?: string }
    return { message: String(err.message ?? e), code: String(err.code ?? "") }
  }
}

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
