// Preflight gate for .github/workflows/db-migrate.yml.
//
// WHY THIS EXISTS. On 2026-09-10 the migrate workflow was dispatched and died
// at Postgres 28P01 before any SQL ran: the SUPABASE_DB_PASS secret was last
// updated 2026-06-28 while DATABASE_URL was updated 2026-08-29, so a password
// rotation never propagated. The workflow had therefore been non-functional
// for roughly eight weeks, and that is precisely why the journal drifted:
// 398 journal entries against 305 ledger rows. Every migration since the
// rotation was applied by some other route.
//
// The hazard is the REPAIR, not the breakage. The moment that secret is
// fixed, the next dispatch will attempt every journal entry with no ledger
// row -- potentially ~93 of them -- and the operator who fixed a stale
// password will not be expecting a 93-migration run.
//
// WHAT THIS DOES NOT CLAIM. scripts/apply-migrations.mjs is already safer
// than drizzle-kit: it applies the SET DIFFERENCE (entries with no ledger
// row) rather than everything above a watermark, it applies E-74 orphans
// drizzle would skip forever, and it runs the whole batch in ONE
// transaction, so a re-applied non-idempotent migration fails and rolls the
// entire run back rather than leaving a half-migrated database. This gate
// does not fix a catastrophe; it removes a surprise. The distinction matters
// and is stated here so nobody reads this file as evidence of a disaster
// that the runner had already made survivable.
//
// WHAT IT ENFORCES. The dispatcher must declare, up front, how many
// migrations they expect this run to apply. If the real number differs, the
// job stops before touching the database and prints the exact list. A run
// that would apply 93 migrations when the operator typed 1 is exactly the
// run that should never start.
//
// D58: this gate can fail, and its failure is the normal case whenever the
// journal and the ledger disagree. A gate that cannot fail is not evidence.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { classifyJournalAgainstLedger } from "./migration-ledger.mjs"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("PREFLIGHT ABORT: DATABASE_URL is not set")
  process.exit(1)
}

const rawExpected = process.env.EXPECTED_TO_APPLY
if (rawExpected === undefined || rawExpected.trim() === "") {
  console.error("PREFLIGHT ABORT: EXPECTED_TO_APPLY is not set")
  process.exit(1)
}
const expected = Number(rawExpected)
if (!Number.isInteger(expected) || expected < 0) {
  console.error(`PREFLIGHT ABORT: EXPECTED_TO_APPLY must be a non-negative integer, got "${rawExpected}"`)
  process.exit(1)
}

// prepare: false -- required through Supabase's transaction-mode pooler,
// same as the runner this gate protects.
const sql = postgres(databaseUrl, { prepare: false, max: 1 })

try {
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"))
  const rows = await sql.unsafe(`select created_at from "drizzle"."__drizzle_migrations"`)
  const { applied, pending, orphaned, watermark } = classifyJournalAgainstLedger(
    journal.entries,
    rows.map((r) => r.created_at),
  )
  const toApply = [...pending, ...orphaned]

  console.log(`journal entries : ${journal.entries.length}`)
  console.log(`ledger rows     : ${rows.length}`)
  console.log(`watermark       : ${watermark ?? "none -- empty database"}`)
  console.log(`already applied : ${applied.length}`)
  console.log(`pending         : ${pending.length}`)
  console.log(`E-74 orphans    : ${orphaned.length}`)
  console.log(`WOULD APPLY     : ${toApply.length}`)
  console.log(`operator expects: ${expected}`)

  if (toApply.length > 0) {
    console.log("\nthe exact set this run would apply, in the order the runner replays it:")
    for (const e of toApply) console.log(`  ${e.idx}\t${e.tag}\twhen=${e.when}`)
  }

  if (toApply.length !== expected) {
    console.error(
      `\nPREFLIGHT ABORT: this run would apply ${toApply.length} migration(s) but the dispatcher ` +
        `declared ${expected}.`,
    )
    console.error(
      "Nothing has been applied. Either re-dispatch with the real number after reading the list " +
        "above, or reconcile the journal against the ledger first (PM-T12).",
    )
    process.exit(1)
  }

  console.log("\nPREFLIGHT OK: declared count matches the real set. Proceeding.")
} catch (err) {
  console.error("PREFLIGHT ABORT: preflight itself failed:", err.message)
  const src = err.cause ?? err
  console.error(
    "Details:",
    JSON.stringify({ code: src.code, detail: src.detail, hint: src.hint, severity: src.severity }, null, 2),
  )
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
