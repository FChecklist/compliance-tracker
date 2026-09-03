// The migration runner. Invoked as `bun run db:migrate` and by
// .github/workflows/db-migrate.yml.
//
// R63 (2026-08-29): replaced `drizzle-kit migrate` in CI. Live-tested that
// the CLI's own spinner swallows the real Postgres error on failure --
// every failed CI run showed only spinner animation frames followed by
// "exited with code 1", with the actual error message (permission denied,
// bad auth, whatever it is) never reaching the log at all. This talks to
// Postgres directly, so a failure surfaces a real error with the Postgres
// error fields (code/detail/hint/schema/table) intact -- no CLI/spinner
// layer in between to lose it.
//
// R67B (2026-09-03): replaced drizzle-orm's own migrate() as well, to fix
// E-74 (platform.r43_faults fault_id E74_MIGRATOR_CURSOR_ORPHANS_MIGRATIONS).
//
//   drizzle's migrator decides what to apply by comparing each journal
//   entry's `when` against ONE watermark -- max(created_at) in
//   drizzle.__drizzle_migrations, read once before the loop. Anything at or
//   below that watermark is skipped silently and permanently, whether or not
//   it has ever been applied. See scripts/migration-ledger.mjs's header for
//   the annotated source of the upstream loop.
//
//   That is not a theoretical hazard. A journal-vs-ledger set difference run
//   live against project pcrjmlpuqsbocqfwoxod on 2026-09-03 found three
//   migrations with no applied row that drizzle would never apply again:
//   0323_construction_boq_parent_unique (when=1787412244154),
//   0328_erp_customers_active_name_unique (when=1787839200000) and
//   0344_force_rls_crm_leads_stage_history (when=1785566544899, merged into
//   array position 314 carrying a timestamp from ~26 days earlier). Each
//   one's DDL is present in production only because a human noticed and
//   applied it by hand; the automated pipeline reported success every time.
//
//   This runner asks the question drizzle does not: which journal entries
//   have NO row in the ledger? It applies exactly those, in journal ARRAY
//   order (the order drizzle itself replays -- readMigrationFiles() iterates
//   the array and never sorts by `idx`), inside one transaction, recording
//   each with the same hash/created_at columns drizzle writes. The ledger
//   format is unchanged, so `drizzle-kit migrate` remains able to read a
//   database this runner has written, and vice versa.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   It does not re-apply, re-order, or re-hash anything that already has a
//   ledger row. An already-applied migration is history and is never touched
//   -- the same rule scripts/check-migration-integrity.mjs enforces from the
//   other side.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { classifyJournalAgainstLedger } from "./migration-ledger.mjs"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

// prepare: false -- required when connecting through Supabase's
// transaction-mode pooler (port 6543). postgres.js prepares statements by
// default; transaction-mode pooling (Supavisor/PgBouncer) does not
// support session-scoped prepared statements, which is what was actually
// causing "CREATE SCHEMA IF NOT EXISTS" to fail (not a permissions or
// connectivity problem -- both were red herrings chased first). This is
// Supabase's own documented requirement for using postgres.js with the
// transaction pooler, not specific to migrations.
const sql = postgres(databaseUrl, { max: 1, prepare: false })

// Byte-for-byte the hash drizzle-orm computes (migrator.js
// readMigrationFiles): sha256 over the file read as a string, with no
// line-ending normalization. Matching it exactly is what keeps the ledger
// interoperable with `drizzle-kit migrate` and readable by
// scripts/check-migration-integrity.mjs's AR-12 comparison.
function migrationHash(fileContent) {
  return createHash("sha256").update(fileContent).digest("hex")
}

// Same split drizzle uses. Files with no breakpoint marker (every
// hand-authored migration in this repo) yield a single chunk, which is then
// sent as one multi-statement command -- also what drizzle does.
function statementsOf(fileContent) {
  return fileContent.split("--> statement-breakpoint").filter((s) => s.trim().length > 0)
}

try {
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"))

  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "drizzle"`)
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY,
       hash text NOT NULL,
       created_at bigint
     )`,
  )

  const rows = await sql.unsafe(`select created_at from "drizzle"."__drizzle_migrations"`)
  const { applied, pending, orphaned, watermark } = classifyJournalAgainstLedger(
    journal.entries,
    rows.map((r) => r.created_at),
  )

  console.log(
    `Journal has ${journal.entries.length} entries. Ledger has ${rows.length} applied rows ` +
      `(watermark ${watermark ?? "none -- empty database"}).`,
  )
  console.log(`  already applied: ${applied.length}`)
  console.log(`  to apply now:    ${pending.length + orphaned.length}`)

  // Loud, because these are the ones drizzle-kit migrate would have dropped
  // on the floor without a word. Anyone reading a deploy log deserves to see
  // that this run is repairing a gap rather than doing routine forward work.
  if (orphaned.length > 0) {
    console.warn(
      `\nE-74 RECOVERY: ${orphaned.length} migration(s) have no applied row AND sit at or below the`,
    )
    console.warn(
      `ledger watermark (${watermark}). \`drizzle-kit migrate\` would skip these silently, forever.`,
    )
    console.warn("This runner applies them:")
    for (const e of orphaned) console.warn(`  - ${e.tag} (when=${e.when})`)
    console.warn(
      "If any of these has already been applied out-of-band, it must be idempotent or its ledger",
    )
    console.warn("row backfilled first -- otherwise this run will fail and roll back, by design.\n")
  }

  const toApply = journal.entries.filter(
    (e) => pending.includes(e) || orphaned.some((o) => o.tag === e.tag),
  )

  if (toApply.length === 0) {
    console.log("Nothing to apply. Migrations are up to date.")
  } else {
    // One transaction for the whole run, matching drizzle's own
    // all-or-nothing semantics: a failure anywhere leaves the database
    // exactly as it was, rather than half-migrated.
    await sql.begin(async (tx) => {
      for (const entry of toApply) {
        const path = `${migrationsFolder}/${entry.tag}.sql`
        const content = readFileSync(path).toString()
        for (const statement of statementsOf(content)) {
          await tx.unsafe(statement)
        }
        await tx.unsafe(
          `insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)`,
          [migrationHash(content), entry.when],
        )
        console.log(`  applied ${entry.tag}`)
      }
    })
    console.log(`\nMigrations applied successfully (${toApply.length} newly recorded).`)
  }
} catch (err) {
  console.error("Migration failed:", err.message)
  console.error("own keys:", Object.getOwnPropertyNames(err))
  console.error("cause:", err.cause ? err.cause.message : null)
  console.error("cause own keys:", err.cause ? Object.getOwnPropertyNames(err.cause) : null)
  const src = err.cause ?? err
  console.error(
    "Details:",
    JSON.stringify(
      {
        code: src.code,
        detail: src.detail,
        hint: src.hint,
        schema: src.schema_name,
        table: src.table_name,
        position: src.position,
        severity: src.severity,
        routine: src.routine,
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
} finally {
  await sql.end()
}
