#!/usr/bin/env node
// AR-12 enforcement (platform.arch_rules): "A MIGRATION EXISTS IN THREE
// PLACES AND CI MUST PROVE ALL THREE AGREE: the .sql file, the journal
// entry, and the applied row." Nothing enforced this until now -- `git grep
// -in "AR-12"` across this repo returned zero hits before this file existed
// (platform.r43_faults fault_id E102_MIGRATION_LEDGER_LINE_ENDING_HASH_SPLIT,
// R60 wave2, 2026-08-28).
//
// WHAT THIS CATCHES, AND WHY IT'S SAFE TO TURN ON TODAY
// ------------------------------------------------------
// drizzle-orm's migrator (node_modules/drizzle-orm/migrator.js) hashes the
// RAW BYTES of each drizzle/*.sql file with no line-ending normalization:
//   hash: crypto.createHash("sha256").update(fs.readFileSync(path).toString())
// Whichever machine/CI runner last ran `db:migrate` baked its own checkout's
// line-ending convention (LF vs Windows CRLF, controlled by git's
// core.autocrlf) into the stored `drizzle.__drizzle_migrations.hash` value.
// A live re-verification on 2026-08-28 found the applied-row ledger split
// 138 rows hashed from a CRLF checkout / 157 from an LF checkout (up from
// 21/269 on first discovery, 22 Aug) -- same file content, different bytes
// at hash time, not a genuine content drift.
//
// This script does NOT try to collapse that split -- rewriting an
// already-applied migration file's line endings, or rewriting the recorded
// ledger hash to match, are both real risks to a live production system
// that a CI script must not take unilaterally (and per this repo's own
// migration rules, an already-applied migration file is never edited).
// Instead, for every journal entry that has a matching applied row, this
// computes sha256 of the file's raw bytes, its LF-normalized form, and its
// CRLF-normalized form, and accepts a match against ANY of the three --
// tolerating the known convention split (in either direction, on either the
// machine that originally ran migrate or the one running this check) while
// still catching real drift, because real drift survives normalization on
// every side.
//
// KNOWN, DOCUMENTED PRE-EXISTING EXCEPTIONS (do not add to this list without
// the same standard of evidence: a dated audit doc + commit citation)
// ---------------------------------------------------------------------
// Three migrations do NOT match any hash variant against their applied
// row, and this is a real, already-investigated, intentional content change
// made AFTER the migration was applied -- not line-ending noise, and not
// something this script (or any CI job) should "fix" by rewriting an
// already-applied migration file. See ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml
// and commit 92887462 ("Fix PR #563 CI: register audit doc in OS.yaml index,
// correct stale migration schema refs"). Re-verified live 2026-08-28 as part
// of building this check (see platform.r43_faults fault_id
// E102_MIGRATION_LEDGER_LINE_ENDING_HASH_SPLIT).
const KNOWN_PRE_EXISTING_HASH_MISMATCHES = new Set([
  "0140_wave166_monitoring_tool_health",
  "0199_gap_dcmd_rich_schema_slice",
  "0253_tenant_ai_config",
])
//
// WHAT THIS DOES NOT DO
// ----------------------
// - Does not check file<->journal parity (every .sql file has a journal
//   entry and vice versa). That is a related but distinct AR-12 gap, already
//   tracked separately (platform.error_log E-63/E-78) with 3 known
//   pre-existing journal-less orphans (0294/0295/0296) -- adding a hard
//   parity gate here would make this brand-new CI job fail on its very first
//   run for an unrelated, already-tracked issue. Out of scope for E-102.
//
// R67B ADDITION (2026-09-03) -- E-74 coverage
// -------------------------------------------
// The version of this script that shipped with E-102 folded every journal
// entry without an applied row into one bucket called "not yet applied" and
// printed it as "expected for recently-added migrations, not a failure".
// That bucket was hiding E-74. It conflates two states that look identical
// in the ledger and could not be more different in consequence:
//
//   pending  -- `when` is above the ledger watermark. The next db:migrate
//               applies it. Genuinely not a failure.
//   orphaned -- `when` is at or below the watermark. drizzle-kit migrate
//               will never apply it, will never mention it, and will exit 0
//               every time. The migration is dead.
//
// Live proof that the distinction mattered: on 2026-09-03 this repo had 43
// journal entries with no applied row. 40 were pending. 3 were orphaned
// (0323_construction_boq_parent_unique, 0328_erp_customers_active_name_unique,
// 0344_force_rls_crm_leads_stage_history) and had been dead for weeks while
// this check reported them as expected.
//
// Two gates are added below:
//   1. DB-free: no NEW backward `when` step may enter the journal. This is
//      the preventive half and runs on every PR, with no database, catching
//      the defect on the branch that introduces it.
//   2. DB-backed: zero orphaned entries. This is the detective half and
//      needs the live ledger, so it degrades to a warning exactly like the
//      hash leg does when DATABASE_URL is absent or the DB is unreachable.
// - Does not run without a live DB connection. AR-12's "applied row" leg is,
//   by definition, a fact about the live database -- there is no way to
//   verify it from the repo alone. If DATABASE_URL is not provided (e.g. a
//   fork, or a context where the secret isn't exposed), this script skips
//   the DB-comparison leg with a clear warning and exits 0 rather than
//   hard-failing CI on an infrastructure precondition it can't control --
//   the same reasoning db-migrate.yml's own header comment documents for why
//   that job is workflow_dispatch-only rather than automatic-on-merge. A
//   genuine DB CONNECTION failure (unreachable, bad credentials) is treated
//   the same way: warn, don't block every PR on prod DB uptime. A genuine
//   HASH MISMATCH for a migration that already has an applied row, and is
//   not in the known-exceptions list above, DOES fail the build -- that's
//   the actual AR-12 guarantee this job exists to provide.
//
// Usage: DATABASE_URL=... node scripts/check-migration-integrity.mjs
// Exit code 0 = no new drift (or DB unavailable, warned), 1 = real drift found.

import { readFileSync } from "fs"
import { createHash } from "crypto"
import { pathToFileURL, fileURLToPath } from "url"
import { classifyJournalAgainstLedger, newBackwardWhenSteps } from "./migration-ledger.mjs"

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url))

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex")
}

// Matches git's own CRLF->LF normalization: only \r\n becomes \n, a lone \r
// (rare, not a real convention used anywhere in this repo) is left alone.
export function normalizeToLF(str) {
  return str.replace(/\r\n/g, "\n")
}

// The inverse: normalize to LF first (so a file that's already a mix, or
// already CRLF, converges to one canonical form) then expand every LF to
// CRLF.
export function normalizeToCRLF(str) {
  return normalizeToLF(str).replace(/\n/g, "\r\n")
}

// True if `recordedHash` (from drizzle.__drizzle_migrations.hash) matches
// the file's raw on-disk bytes, its LF-normalized form, or its CRLF-
// normalized form. All three are checked -- not just raw+LF -- because
// which one is "raw" depends on which OS/checkout is running this check:
// on this repo's Windows dev checkouts (core.autocrlf=true) raw bytes are
// always CRLF regardless of what's actually stored in the git blob; on a
// Linux CI runner (core.autocrlf unset/false, the actions/checkout
// default, and no .gitattributes forcing conversion yet) raw bytes are
// exactly the committed blob bytes, which vary per file. Checking all three
// forms makes the comparison agree regardless of which machine originally
// ran db:migrate AND which machine is running this check -- the only thing
// that fails all three is genuine content drift, which is the actual signal
// AR-12 needs.
export function recordedHashMatchesFile(fileContent, recordedHash) {
  if (sha256Hex(fileContent) === recordedHash) return { matched: true, via: "raw" }
  if (sha256Hex(normalizeToLF(fileContent)) === recordedHash) return { matched: true, via: "lf-normalized" }
  if (sha256Hex(normalizeToCRLF(fileContent)) === recordedHash) return { matched: true, via: "crlf-normalized" }
  return { matched: false, via: null }
}

export function readJournal(dir = drizzleDir) {
  const journalPath = `${dir}/meta/_journal.json`
  return JSON.parse(readFileSync(journalPath, "utf8"))
}

// Cheap, DB-independent guard: confirms .gitattributes still forces a single
// line-ending convention for drizzle/*.sql, so a future edit can't silently
// remove the one piece of this fix that prevents the split from recurring
// for brand-new migrations. Accepts any explicit eol= setting (lf or crlf --
// either is a real fix; this repo chose lf) but not a bare `text` with no
// eol=, which normalizes on checkin/checkout to whatever the FIRST commit
// happened to use per-file, not a single repo-wide convention.
export function gitattributesForcesConsistentEol(gitattributesContent) {
  return gitattributesContent
    .split("\n")
    .some((line) => /^drizzle\/\*\.sql\s+.*\beol=(lf|crlf)\b/.test(line.trim()))
}

// Core reconciliation, DB-access-free: given journal entries, a map of
// applied rows keyed by their `created_at` timestamp (which is how
// drizzle-kit migrate itself correlates a journal entry to an applied row --
// see readMigrationFiles()'s folderMillis / journal `when` field, both of
// which come from the same source), and a function to read a migration
// file's content, returns which entries are fine, which are legitimately
// not-yet-applied, and which are real, unexplained mismatches.
export function reconcile(journalEntries, appliedRowsByCreatedAt, readFile, knownExceptions = KNOWN_PRE_EXISTING_HASH_MISMATCHES) {
  const ok = []
  const notYetApplied = []
  const mismatched = []
  const knownExceptionsSeen = []

  for (const entry of journalEntries) {
    const row = appliedRowsByCreatedAt.get(String(entry.when))
    if (!row) {
      notYetApplied.push(entry.tag)
      continue
    }
    let content
    try {
      content = readFile(entry.tag)
    } catch {
      mismatched.push({ tag: entry.tag, reason: "file missing on disk despite having a journal entry and an applied row" })
      continue
    }
    const { matched, via } = recordedHashMatchesFile(content, row.hash)
    if (matched) {
      ok.push({ tag: entry.tag, via })
      continue
    }
    if (knownExceptions.has(entry.tag)) {
      knownExceptionsSeen.push(entry.tag)
      continue
    }
    mismatched.push({ tag: entry.tag, reason: "recorded applied-row hash matches none of the file's raw/LF-normalized/CRLF-normalized forms -- real content drift", recordedHash: row.hash })
  }

  return { ok, notYetApplied, mismatched, knownExceptionsSeen }
}

async function main() {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url))
  let gitattributes
  try {
    gitattributes = readFileSync(`${repoRoot}/.gitattributes`, "utf8")
  } catch {
    gitattributes = ""
  }
  if (!gitattributesForcesConsistentEol(gitattributes)) {
    console.error("ERROR: AR-12 regression -- .gitattributes no longer forces a single line-ending")
    console.error("convention for drizzle/*.sql (expected a line like `drizzle/*.sql text eol=lf`).")
    console.error("Without it, a NEW migration committed from a different OS/editor can silently")
    console.error("re-introduce the exact CRLF/LF hash split this check exists to prevent.")
    process.exit(1)
  }

  const journal = readJournal()
  const readFile = (tag) => readFileSync(`${drizzleDir}/${tag}.sql`, "utf8")

  // Gate 1 (E-74, preventive, DB-free). A migration whose `when` is at or
  // below the maximum `when` of any entry ahead of it in the journal array
  // is a latent orphan: once anything that overtakes it has been applied to
  // a database, drizzle's watermark can never reach back down for it. This
  // is the only check that can catch the defect while it is still cheap to
  // fix -- before merge, before the file has been applied anywhere, when
  // giving it a fresh timestamp costs nothing.
  const backwardSteps = newBackwardWhenSteps(journal.entries)
  if (backwardSteps.length > 0) {
    console.error("ERROR: E-74 violation -- new migration(s) carry a `when` timestamp at or below")
    console.error("an entry that already precedes them in drizzle/meta/_journal.json:")
    for (const s of backwardSteps) {
      console.error(
        `  - ${s.tag} (when=${s.when}) sits after ${s.precededByTag} (when=${s.precededByWhen})`,
      )
    }
    console.error("")
    console.error("drizzle-kit migrate applies an entry only when the single max(created_at) in")
    console.error("drizzle.__drizzle_migrations is strictly LESS than the entry's `when`. Once the")
    console.error("entry above it has been applied anywhere, this migration is unreachable on that")
    console.error("database forever -- skipped silently, exit code 0, no warning.")
    console.error("")
    console.error("Fix: give this migration a `when` above the current maximum in the journal")
    console.error("(regenerate it with `bun run db:generate`, or edit the journal entry directly --")
    console.error("safe precisely because it has not been applied anywhere yet). Do NOT add it to")
    console.error("KNOWN_PRE_EXISTING_BACKWARD_WHEN_STEPS in scripts/migration-ledger.mjs; that list")
    console.error("is grandfathered history, not an escape hatch for new work.")
    process.exit(1)
  }

  if (!process.env.DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL not set -- skipping the journal<->applied-row leg of AR-12")
    console.warn("(file<->journal parity is a separate, already-tracked check -- see this file's header).")
    console.warn(`${journal.entries.length} journal entries present; no live-DB comparison performed this run.`)
    process.exit(0)
  }

  let sql
  try {
    const postgres = (await import("postgres")).default
    sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 5 })
    const rows = await sql`select id, hash, created_at from drizzle.__drizzle_migrations`
    const appliedByCreatedAt = new Map(rows.map(r => [String(r.created_at), r]))

    const { ok, notYetApplied, mismatched, knownExceptionsSeen } = reconcile(journal.entries, appliedByCreatedAt, readFile)

    // Gate 2 (E-74, detective). Split the old undifferentiated
    // "not yet applied" bucket into the two states that actually matter.
    const { pending, orphaned, watermark } = classifyJournalAgainstLedger(
      journal.entries,
      rows.map((r) => r.created_at),
    )

    console.log(`AR-12 journal<->applied-row check: ${ok.length} agree, ${notYetApplied.length} not yet applied, ${knownExceptionsSeen.length} known pre-existing exception(s), ${mismatched.length} unexplained mismatch(es).`)
    console.log(`E-74 watermark check: ledger watermark ${watermark ?? "none"}, ${pending.length} pending, ${orphaned.length} orphaned.`)
    if (pending.length > 0) {
      console.log("Pending -- `when` is above the watermark, next db:migrate applies these (not a failure):")
      for (const e of pending) console.log(`  - ${e.tag}`)
    }
    if (knownExceptionsSeen.length > 0) {
      console.log("Known, documented pre-existing exceptions (ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml):")
      for (const tag of knownExceptionsSeen) console.log(`  - ${tag}`)
    }

    if (orphaned.length > 0) {
      console.error("\nERROR: E-74 violation -- the following migration(s) have NO applied row and a `when`")
      console.error(`at or below the ledger watermark (${watermark}). drizzle-kit migrate will never apply`)
      console.error("them, will never report them, and will exit 0 on every future run:")
      for (const e of orphaned) console.error(`  - drizzle/${e.tag}.sql (when=${e.when})`)
      console.error("")
      console.error("Resolve by determining, for each one, whether its DDL is already present in the")
      console.error("database (applied out-of-band by hand -- then backfill its drizzle.__drizzle_migrations")
      console.error("row so the ledger tells the truth) or genuinely missing (then apply it via")
      console.error("`bun run db:migrate`, whose set-difference runner does apply orphans -- see")
      console.error("scripts/apply-migrations.mjs). Never resolve it by deleting the migration.")
      await sql.end({ timeout: 5 })
      process.exit(1)
    }

    if (mismatched.length > 0) {
      console.error("\nERROR: AR-12 violation -- the following migration(s) have an applied row whose hash matches")
      console.error("none of the file's raw/LF-normalized/CRLF-normalized forms. This means the file's real content")
      console.error("(not just line endings) no longer matches what was actually applied to the database:")
      for (const m of mismatched) {
        console.error(`  - drizzle/${m.tag}.sql: ${m.reason}`)
      }
      console.error("\nIf this is a NEW, understood, deliberate post-hoc correction (rare -- matching the precedent in")
      console.error("ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml), add it to KNOWN_PRE_EXISTING_HASH_MISMATCHES in this")
      console.error("script with a citation, in its own reviewed PR. Do not edit the already-applied migration file itself.")
      await sql.end({ timeout: 5 })
      process.exit(1)
    }

    await sql.end({ timeout: 5 })
    process.exit(0)
  } catch (err) {
    // A DB the check can't reach (network blip, credential rotation, a PR
    // context where the secret isn't exposed) must not block every PR from
    // merging -- same reasoning as db-migrate.yml's header comment on why
    // that job is manual-dispatch-only. Warn loudly, exit clean.
    console.warn(`WARNING: could not complete the journal<->applied-row DB check (${err.message ?? err}).`)
    console.warn("Not failing CI on this -- an unreachable database is an infrastructure condition, not proof of drift.")
    try { await sql?.end({ timeout: 1 }) } catch { /* best-effort cleanup */ }
    process.exit(0)
  }
}

// Only run main() when executed directly (not when imported for its pure
// functions by the test file) -- pathToFileURL handles both POSIX and
// Windows argv[1] paths correctly, unlike a manual string comparison.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
