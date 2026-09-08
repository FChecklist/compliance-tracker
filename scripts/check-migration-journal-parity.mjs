#!/usr/bin/env node
// R81 -- every migration file must be REACHABLE, or be listed as debt.
//
// THE HOLE THIS CLOSES. This repository has TWO independent migration ledgers
// and they do not reconcile:
//
//   1. drizzle/meta/_journal.json  +  drizzle.__drizzle_migrations
//      Read by `bun db:migrate` (scripts/apply-migrations.mjs) and by the CI
//      replay harness (scripts/replay-migrations-from-empty.mjs). BOTH iterate
//      journal.entries. A .sql file with no journal entry is never applied and
//      never replayed.
//   2. supabase_migrations.schema_migrations
//      Written when DDL is applied through Supabase's own migration path.
//      Nothing in this repository reads it.
//
// So DDL applied through path 2 is LIVE and simultaneously INVISIBLE to every
// mechanism that builds a fresh database. On 2026-09-08 four migrations were in
// exactly that state. The replay harness reported green throughout, because a
// harness cannot miss a file it never looks at -- the same false-assurance
// shape as a passing test suite for a control with no call sites.
//
// check-migration-integrity.mjs deliberately does NOT check file<->journal
// parity; its own header says so and cites three known orphans (0294-0296) as
// the reason. That exception was sound when it was three. It had grown to
// sixteen before anything reported it, because nothing was counting.
//
// WHAT THIS CHECKS, and why the allowlist is the point rather than a loophole:
// a bare "no orphans" rule would fail on day one against files that are
// legitimately unjournaled, so it would be switched off within a week. Instead
// every orphan must be NAMED here with a category:
//
//   OPERATIONAL -- a one-off maintenance script that was never schema and must
//                  never replay (the R75 grant/revoke pairs temporarily lift a
//                  privilege and put it back; replaying half of that pair on a
//                  fresh database would grant and never revoke).
//   DEBT        -- real schema that IS missing from fresh databases. Each entry
//                  names its fault row. Emptying this category closes the fault.
//
// A NEW unlisted orphan fails the build. That is the regression this exists to
// stop: it is what would have caught all four of 2026-09-08's, on the commit
// that introduced them.
import fs from "node:fs"
import path from "node:path"

const DRIZZLE = path.resolve(import.meta.dirname, "..", "drizzle")

const ALLOWED = {
  "0294_r42_seq12_submissions_pipeline_tasks": { cat: "DEBT", note: "pre-existing orphan named in check-migration-integrity.mjs; fault R81_F37" },
  "0295_r42_seq20_screen_registry": { cat: "DEBT", note: "pre-existing orphan named in check-migration-integrity.mjs; fault R81_F37" },
  "0296_r42_seq15_fix_l2_cross_org_discovery": { cat: "DEBT", note: "pre-existing orphan named in check-migration-integrity.mjs; fault R81_F37" },
  "0546_r68_phase4_memory_records_search_vector": { cat: "DEBT", note: "real schema (search_vector); absent from fresh DBs; fault R81_F37" },
  "0547_r68_phase8_img_product_branch": { cat: "DEBT", note: "real schema (IMG product branch); fault R81_F37" },
  "0548_r70_phase7_location_stamping": { cat: "DEBT", note: "real schema (location columns); fault R81_F37" },
  "0549_r70_phase7_graph_edge_validity_bounds": { cat: "DEBT", note: "real schema (validity bounds); fault R81_F37" },
  "0550_r70_phase7_current_row_indexes": { cat: "DEBT", note: "real schema (partial indexes); fault R81_F37" },
  "0571_r80add_submission_telemetry": { cat: "DEBT", note: "R80's; applied via Supabase path only; owner session notified 2026-09-08; fault R81_F37" },
  "0562_r75_phase0_backup_grant_missing_sequence_select": { cat: "OPERATIONAL", note: "R75 Phase 0 one-off backup grant" },
  "0563_r75_phase0_backup_grant_remaining_sequence_select": { cat: "OPERATIONAL", note: "R75 Phase 0 one-off backup grant" },
  "0564_r75_phase0_backup_temp_bypassrls_grant": { cat: "OPERATIONAL", note: "temporary BYPASSRLS; paired with 0566 revoke -- must never replay" },
  "0565_r75_phase0_backup_grant_embedding_cache_select": { cat: "OPERATIONAL", note: "R75 Phase 0 one-off backup grant" },
  "0566_r75_phase0_backup_temp_bypassrls_revoke": { cat: "OPERATIONAL", note: "revoke half of the 0564 pair" },
  "0567_r75_phase0_backup_temp_bypassrls_grant_2": { cat: "OPERATIONAL", note: "temporary BYPASSRLS; paired with 0568 revoke -- must never replay" },
  "0568_r75_phase0_backup_temp_bypassrls_revoke_2": { cat: "OPERATIONAL", note: "revoke half of the 0567 pair" },
}

const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"))
const tags = new Set(journal.entries.map((e) => e.tag))
const files = fs.readdirSync(DRIZZLE).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -4)).sort()

const failures = []

// direction 1: a .sql file nobody will ever apply
const orphans = files.filter((f) => !tags.has(f))
for (const o of orphans) {
  if (!ALLOWED[o]) {
    failures.push(
      `${o}.sql has NO entry in drizzle/meta/_journal.json.\n` +
      `    Nothing applies it and nothing replays it -- it will be missing from every fresh database,\n` +
      `    silently, including CI's. If it was applied through Supabase's migration path, that ledger\n` +
      `    is not read here. Add a journal entry, or list it in ALLOWED with a category and a reason.`,
    )
  }
}

// direction 2: a journal entry whose file is gone -- the run would crash mid-transaction
const fileSet = new Set(files)
for (const e of journal.entries) {
  if (!fileSet.has(e.tag)) {
    failures.push(`journal entry "${e.tag}" has no drizzle/${e.tag}.sql. apply-migrations.mjs would throw on readFileSync mid-transaction.`)
  }
}

// direction 3: the allowlist must not rot either
for (const k of Object.keys(ALLOWED)) {
  if (!fileSet.has(k)) failures.push(`ALLOWED lists "${k}" but drizzle/${k}.sql does not exist. Remove the stale entry.`)
  else if (tags.has(k)) failures.push(`ALLOWED lists "${k}" but it IS journaled now. Remove the entry -- the exception is spent.`)
}

const debt = orphans.filter((o) => ALLOWED[o]?.cat === "DEBT")
const ops = orphans.filter((o) => ALLOWED[o]?.cat === "OPERATIONAL")
console.log(`migration journal parity: ${files.length} .sql files, ${journal.entries.length} journal entries`)
console.log(`  unjournaled: ${orphans.length}  (${debt.length} DEBT, ${ops.length} OPERATIONAL, ${orphans.length - debt.length - ops.length} UNLISTED)`)
if (debt.length) {
  console.log(`\n  DEBT -- real schema missing from fresh databases (fault R81_F37):`)
  for (const d of debt) console.log(`    ${d}`)
  console.log(`  Closing R81_F37 means emptying that list, not extending it.`)
}
for (const f of failures) console.error(`\nFAIL  ${f}`)
if (failures.length) {
  console.error(`\n${failures.length} failure(s). A migration the build cannot see is not applied, however green the replay is.`)
  process.exit(1)
}
process.exit(0)
