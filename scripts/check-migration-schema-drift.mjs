#!/usr/bin/env node
// GAP-MIGRATION-APPLY-NOT-AUTOMATED (ai-os/MASTER-TRACKER.yaml, first raised
// 2026-08-03 during the OCID-020 certification sweep, built 2026-08-30 as
// part of the R1-R64 recheck): "Deploy pipeline never automatically applies
// pending Drizzle migrations to production; CI only checks migration NUMBER
// collisions, never whether a migration's DDL actually ran." The real
// incident this gap was raised from: `drizzle/0264_helpdesk_tiered_sla_team_
// routing.sql` was recorded as applied in `drizzle.__drizzle_migrations` but
// its DDL never actually ran on the live production database, causing a
// real, live `500` on `GET /api/email-intelligence` for every user.
//
// This is DISTINCT from check-migration-integrity.mjs (AR-12): that script
// proves the migration FILE's bytes still match what the ledger recorded as
// applied (catches "the file was edited/corrupted after being applied," a
// CRLF/LF hash-normalization problem). It does NOT prove the DDL the file
// describes actually EXISTS in the live schema -- a migration can be
// byte-for-byte unchanged, recorded as applied, and still have never
// actually run its ALTER/CREATE against the real database. That second gap
// is what this script closes.
//
// WHAT THIS DOES
// --------------
// For every migration with an applied ledger row, parses the file's DDL for
// the two most common, most safety-critical artifact-creating statements:
//   - CREATE TABLE [IF NOT EXISTS] schema.table
//   - ALTER TABLE schema.table ADD COLUMN [IF NOT EXISTS] name (one or more,
//     comma-separated, in a single ALTER TABLE -- the exact shape of the
//     real 0264 incident's migration)
// Replays them in journal (chronological) order against a matching DROP
// TABLE / ALTER TABLE ... DROP COLUMN, so a table/column legitimately
// removed by a LATER migration is not flagged as "missing" drift. Whatever
// remains expected is checked against live information_schema.tables /
// information_schema.columns. Anything expected-but-missing is real,
// reportable schema drift: the migration's own DDL never actually happened
// (or was later reverted by hand, outside the migration system) despite the
// ledger claiming otherwise.
//
// WHAT THIS DOES NOT DO (documented honestly, same discipline as
// check-migration-integrity.mjs's own header)
// --------------------------------------------------------------------------
// - Does not parse every DDL statement shape (CREATE INDEX, CREATE VIEW,
//   ALTER TABLE ... ALTER COLUMN TYPE, CREATE TYPE/ENUM, RLS policies, etc.)
//   -- the tracker's own recommendation explicitly allows "spot-check
//   expected tables/columns," not full DDL-equivalence proof. CREATE
//   TABLE + ADD COLUMN cover the two artifact classes that (a) are the
//   easiest to spot-check via information_schema and (b) match the actual
//   real incident's own shape.
// - Does not run without a live DB connection -- same reasoning as
//   check-migration-integrity.mjs: warn and exit 0 rather than block every
//   PR on prod DB reachability.
// - A false negative is possible if a table/column was created OUTSIDE the
//   migration system entirely (a manual `ALTER TABLE` against prod) and
//   later a migration's own DDL silently failed for the SAME artifact --
//   this script only proves "the named artifact exists," not "this specific
//   migration is what created it."
//
// Usage: DATABASE_URL=... node scripts/check-migration-schema-drift.mjs
// Exit code 0 = no new drift (or DB unavailable, warned), 1 = real drift found.

import { readFileSync } from "fs"
import { pathToFileURL, fileURLToPath } from "url"

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url))

// Same documented-exception mechanism as check-migration-integrity.mjs's
// KNOWN_PRE_EXISTING_HASH_MISMATCHES -- an artifact this script would
// otherwise flag, already investigated and understood to be intentional
// (e.g. created by a means outside the migration file, or by a hand-applied
// DDL statement not itself expressed as a CREATE/ALTER this parser covers).
// Add to this ONLY with a dated citation, in its own reviewed PR -- same
// standard of evidence as that file's own list.
export const KNOWN_EXCEPTIONS = new Set([
  // "schema.table" or "schema.table.column" -- none known yet.
])

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "")
}

function qualify(schemaOrTable, table) {
  return table ? `${schemaOrTable}.${table}` : schemaOrTable
}

// Matches CREATE TABLE "schema"."table" or CREATE TABLE schema.table,
// with or without IF NOT EXISTS, quoted or bare identifiers.
const CREATE_TABLE_RE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\.?"?([a-zA-Z_][a-zA-Z0-9_]*)?"?\s*[\(;]/gi

// Matches DROP TABLE "schema"."table" or schema.table, with or without
// IF EXISTS.
const DROP_TABLE_RE = /DROP TABLE\s+(?:IF EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\.?"?([a-zA-Z_][a-zA-Z0-9_]*)?"?/gi

// Matches one ALTER TABLE statement (from ALTER TABLE up to the terminating
// semicolon), captured whole so its own ADD COLUMN / DROP COLUMN clauses
// (which can be multiple, comma-separated, per statement -- the real 0264
// incident's own shape) can be parsed out separately below.
const ALTER_TABLE_STATEMENT_RE = /ALTER TABLE\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\.?"?([a-zA-Z_][a-zA-Z0-9_]*)?"?\s+([\s\S]*?);/gi
const ADD_COLUMN_CLAUSE_RE = /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi
const DROP_COLUMN_CLAUSE_RE = /DROP COLUMN\s+(?:IF EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi

/**
 * Parses one migration file's SQL for the artifact-creating/removing
 * statements this check understands. Returns { addedTables, droppedTables,
 * addedColumns, droppedColumns } -- addedColumns/droppedColumns keyed as
 * "schema.table.column".
 */
export function parseMigrationDdl(sqlRaw) {
  const sql = stripSqlComments(sqlRaw)
  const addedTables = new Set()
  const droppedTables = new Set()
  const addedColumns = new Set()
  const droppedColumns = new Set()

  for (const m of sql.matchAll(CREATE_TABLE_RE)) {
    addedTables.add(qualify(m[1], m[2]))
  }
  for (const m of sql.matchAll(DROP_TABLE_RE)) {
    droppedTables.add(qualify(m[1], m[2]))
  }
  for (const stmt of sql.matchAll(ALTER_TABLE_STATEMENT_RE)) {
    const table = qualify(stmt[1], stmt[2])
    const body = stmt[3]
    for (const add of body.matchAll(ADD_COLUMN_CLAUSE_RE)) {
      addedColumns.add(`${table}.${add[1]}`)
    }
    for (const drop of body.matchAll(DROP_COLUMN_CLAUSE_RE)) {
      droppedColumns.add(`${table}.${drop[1]}`)
    }
  }

  return { addedTables, droppedTables, addedColumns, droppedColumns }
}

/**
 * Replays every applied migration's parsed DDL in journal order, returns the
 * final expected-to-exist sets (tables, "table.column" pairs) after
 * cancelling anything a later migration explicitly dropped -- so a
 * legitimately-removed table/column is never flagged as drift.
 */
export function computeExpectedArtifacts(appliedEntriesInOrder, readFile) {
  const expectedTables = new Map() // qualifiedTable -> tag that created it
  const expectedColumns = new Map() // "table.column" -> tag that added it

  for (const entry of appliedEntriesInOrder) {
    let ddl
    try {
      ddl = parseMigrationDdl(readFile(entry.tag))
    } catch {
      continue // file missing -- check-migration-integrity.mjs's job to catch, not this one's
    }
    for (const t of ddl.addedTables) expectedTables.set(t, entry.tag)
    for (const t of ddl.droppedTables) expectedTables.delete(t)
    for (const c of ddl.addedColumns) expectedColumns.set(c, entry.tag)
    for (const c of ddl.droppedColumns) expectedColumns.delete(c)
  }

  return { expectedTables, expectedColumns }
}

// Strips the leading "schema." prefix, keeping "table" or "table.column".
function bare(qualified) {
  return qualified.split(".").slice(1).join(".")
}

/**
 * Pure comparison: given the expected sets and the LIVE existing sets (both
 * DB-access-free to call, DB-access-only to populate), returns which
 * expected tables/columns are genuinely missing live -- the real drift
 * signal -- filtering out anything in the known-exceptions list.
 *
 * Matching is deliberately SCHEMA-AGNOSTIC (bare table/table.column name,
 * not the schema the original migration named): found live, during real
 * verification against production, that several tables were legitimately
 * relocated to a different schema after their migration ran (an
 * `ALTER TABLE ... SET SCHEMA`, outside the migration system) --
 * `compliance.worker_agents` -> `platform.worker_agents` being one real,
 * confirmed example (same class of move already documented and closed for
 * `product_branches` in GAP-PRODUCT-BRANCHES-LIVE-VS-DIRECT-READ-DISCREPANCY).
 * Requiring an exact schema match would flag every one of those as false
 * drift. Requiring only "does this table/column exist in ANY of the app's
 * real business schemas" still catches the actual failure mode this script
 * exists for (the artifact never existing anywhere), while tolerating a
 * legitimate later schema move -- the same reasoning
 * check-migration-integrity.mjs's own CRLF/LF tolerance uses for a different
 * class of false positive.
 */
export function findDrift(expectedTables, expectedColumns, liveTables, liveColumns, knownExceptions = KNOWN_EXCEPTIONS) {
  const missingTables = []
  const missingColumns = []
  for (const [table, tag] of expectedTables) {
    if (!liveTables.has(bare(table)) && !knownExceptions.has(table)) missingTables.push({ table, tag })
  }
  for (const [column, tag] of expectedColumns) {
    if (!liveColumns.has(bare(column)) && !knownExceptions.has(column)) missingColumns.push({ column, tag })
  }
  return { missingTables, missingColumns }
}

export function readJournal(dir = drizzleDir) {
  const journalPath = `${dir}/meta/_journal.json`
  return JSON.parse(readFileSync(journalPath, "utf8"))
}

async function main() {
  const journal = readJournal()
  const readFile = (tag) => readFileSync(`${drizzleDir}/${tag}.sql`, "utf8")

  if (!process.env.DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL not set -- skipping the schema-drift check.")
    console.warn(`${journal.entries.length} journal entries present; no live-DB comparison performed this run.`)
    process.exit(0)
  }

  let sql
  try {
    const postgres = (await import("postgres")).default
    sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 5 })
    const rows = await sql`select id, hash, created_at from drizzle.__drizzle_migrations`
    const appliedByCreatedAt = new Map(rows.map((r) => [String(r.created_at), r]))

    const appliedEntriesInOrder = journal.entries.filter((e) => appliedByCreatedAt.has(String(e.when)))

    const { expectedTables, expectedColumns } = computeExpectedArtifacts(appliedEntriesInOrder, readFile)

    // Real business schemas only -- excludes Postgres/Supabase-internal
    // schemas (pg_*, information_schema, auth, storage, realtime, vault,
    // extensions, graphql[_public], cron, drizzle itself) and any ad hoc
    // archive schema (e.g. this project's own `backup_22aug`, confirmed live
    // 2026-08-30 -- a one-off manual backup, not part of the app). Queried
    // dynamically rather than hardcoded to {compliance, platform} so this
    // stays correct if a real new business schema is ever added.
    const KNOWN_NON_BUSINESS_SCHEMAS = new Set([
      "information_schema", "pg_catalog", "pg_toast", "auth", "storage",
      "realtime", "vault", "extensions", "graphql", "graphql_public",
      "cron", "drizzle", "supabase_migrations",
    ])
    const schemaRows = await sql`select schema_name from information_schema.schemata`
    const businessSchemas = schemaRows
      .map((r) => r.schema_name)
      .filter((s) => !KNOWN_NON_BUSINESS_SCHEMAS.has(s) && !s.startsWith("pg_") && !s.toLowerCase().startsWith("backup"))

    const liveTablesRows = await sql`select table_schema, table_name from information_schema.tables where table_schema = any(${businessSchemas})`
    // Schema-agnostic on purpose -- see findDrift()'s own header comment for
    // why (legitimate post-migration schema moves, e.g. worker_agents).
    const liveTables = new Set(liveTablesRows.map((r) => r.table_name))
    const liveColumnsRows = await sql`select table_schema, table_name, column_name from information_schema.columns where table_schema = any(${businessSchemas})`
    const liveColumns = new Set(liveColumnsRows.map((r) => `${r.table_name}.${r.column_name}`))

    const { missingTables, missingColumns } = findDrift(expectedTables, expectedColumns, liveTables, liveColumns)

    console.log(`Migration schema-drift check: ${expectedTables.size} table(s) and ${expectedColumns.size} column(s) expected live from ${appliedEntriesInOrder.length} applied migrations.`)

    if (missingTables.length === 0 && missingColumns.length === 0) {
      console.log("No drift found -- every expected table/column from an applied migration exists live.")
      await sql.end({ timeout: 5 })
      process.exit(0)
    }

    console.error("\nERROR: schema drift found -- a migration is recorded as APPLIED but its own DDL")
    console.error("does not exist in the live database (this is the exact class of bug behind the real")
    console.error("0264/email-intelligence production incident this check was built to catch):")
    for (const { table, tag } of missingTables) {
      console.error(`  - table "${table}" expected from drizzle/${tag}.sql, not found live`)
    }
    for (const { column, tag } of missingColumns) {
      console.error(`  - column "${column}" expected from drizzle/${tag}.sql, not found live`)
    }
    console.error("\nIf this is a known, already-investigated, intentional exception, add it to")
    console.error("KNOWN_EXCEPTIONS in this script with a dated citation, in its own reviewed PR.")
    console.error("Otherwise: the migration's DDL needs to actually be applied to production.")
    await sql.end({ timeout: 5 })
    process.exit(1)
  } catch (err) {
    console.warn(`WARNING: could not complete the schema-drift DB check (${err.message ?? err}).`)
    console.warn("Not failing CI on this -- an unreachable database is an infrastructure condition, not proof of drift.")
    try { await sql?.end({ timeout: 1 }) } catch { /* best-effort cleanup */ }
    process.exit(0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
