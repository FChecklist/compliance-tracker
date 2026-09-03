// Shared, DB-free reasoning about the relationship between
// drizzle/meta/_journal.json and the applied-row ledger
// drizzle.__drizzle_migrations. Imported by BOTH the migration runner
// (scripts/apply-migrations.mjs) and the CI integrity gate
// (scripts/check-migration-integrity.mjs) so the two can never drift apart
// about what "already applied" means.
//
// WHY THIS FILE EXISTS -- E-74 (platform.r43_faults fault_id
// E74_MIGRATOR_CURSOR_ORPHANS_MIGRATIONS)
// ----------------------------------------------------------------------
// drizzle-orm's own migrator does NOT ask "which journal entries have no
// applied row?". Read it directly (node_modules/drizzle-orm/pg-core/
// dialect.js, PgDialect.migrate(), drizzle-orm 0.45.2):
//
//   const dbMigrations = await session.all(
//     sql`select id, hash, created_at from drizzle.__drizzle_migrations
//         order by created_at desc limit 1`)
//   const lastDbMigration = dbMigrations[0]
//   await session.transaction(async (tx) => {
//     for await (const migration of migrations) {
//       if (!lastDbMigration ||
//           Number(lastDbMigration.created_at) < migration.folderMillis) { ... }
//     }
//   })
//
// It reads ONE row -- the highest created_at -- once, before the loop, and
// then applies an entry only if that single watermark is strictly less than
// the entry's `when`. Three consequences, all confirmed at the source level:
//
//   1. An entry whose `when` is <= the watermark is skipped SILENTLY and
//      PERMANENTLY. Not "skipped this run" -- there is no subsequent run in
//      which it becomes eligible, because the watermark only ever rises.
//      No error, no warning, exit code 0.
//   2. The comparison is on a timestamp, not on identity. Nothing checks
//      that the entry has an applied row; two entries can share a `when`,
//      and an entry can be missing from the ledger while later ones are
//      present.
//   3. journal.entries is walked in ARRAY order (readMigrationFiles() in
//      node_modules/drizzle-orm/migrator.js iterates the array; the `idx`
//      field is never sorted on), so array order and `when` order are
//      independent -- and in this repo they genuinely disagree.
//
// So any migration merged with a `when` below the current maximum -- a
// long-lived branch merged after a later migration already ran, a manually
// backdated timestamp, a cherry-pick -- is silently dropped forever. That
// is not a hypothetical: on 2026-09-03 a live journal-vs-ledger set
// difference against project pcrjmlpuqsbocqfwoxod found 3 such entries
// (0323_construction_boq_parent_unique, 0328_erp_customers_active_name_unique,
// 0344_force_rls_crm_leads_stage_history), each with its DDL present in
// production because a human had applied it out-of-band, and none of them
// ever recorded in the ledger.
//
// The functions below express the check drizzle should have made: a genuine
// SET DIFFERENCE between the journal and the ledger.

// drizzle correlates a journal entry to an applied row by the entry's `when`
// (readMigrationFiles() copies journal `when` into `folderMillis`, and
// migrate() inserts that value as `created_at`). Same key here, so this file
// and drizzle agree on identity even though they disagree on the gate.
export function appliedKey(entryOrRow) {
  const raw = entryOrRow?.when ?? entryOrRow?.created_at ?? entryOrRow
  return Number(raw)
}

// The single number drizzle's migrator compares everything against.
// null when the ledger is empty (a genuinely fresh database), which is the
// one case where drizzle applies every entry.
export function ledgerWatermark(appliedCreatedAtValues) {
  const nums = [...appliedCreatedAtValues].map(Number).filter((n) => Number.isFinite(n))
  if (nums.length === 0) return null
  return Math.max(...nums)
}

// True if drizzle's migrator would apply this entry given a ledger
// watermark. Mirrors dialect.js's `!lastDbMigration || watermark < when`
// EXACTLY, including the strictness of `<` (an entry whose `when` equals the
// watermark is skipped, not applied).
export function drizzleWouldApply(entryWhen, watermark) {
  if (watermark === null) return true
  return watermark < Number(entryWhen)
}

/**
 * Split the journal into what is already recorded, what is genuinely still
 * coming, and what drizzle's watermark has orphaned.
 *
 * - `applied`  : has a ledger row.
 * - `pending`  : no ledger row, but `when` is above the watermark, so the
 *                next `db:migrate` will apply it. Normal and expected for
 *                any migration added since the last deploy.
 * - `orphaned` : no ledger row AND `when` is at or below the watermark.
 *                drizzle will never apply it, will never say so, and will
 *                exit 0. This is E-74. An empty `orphaned` array is the
 *                invariant CI is meant to hold.
 *
 * Pure: takes the applied timestamps as a plain iterable so it can be tested
 * without a database and reused by the runner before it opens a transaction.
 */
export function classifyJournalAgainstLedger(journalEntries, appliedCreatedAtValues) {
  const appliedSet = new Set([...appliedCreatedAtValues].map(Number))
  const watermark = ledgerWatermark(appliedSet)
  const applied = []
  const pending = []
  const orphaned = []
  for (const entry of journalEntries) {
    const key = appliedKey(entry)
    if (appliedSet.has(key)) {
      applied.push(entry)
    } else if (drizzleWouldApply(key, watermark)) {
      pending.push(entry)
    } else {
      orphaned.push({ ...entry, watermark })
    }
  }
  return { applied, pending, orphaned, watermark }
}

/**
 * The DB-free half of the E-74 fix, and the only half that can run on a pull
 * request before anything is applied anywhere.
 *
 * Walks journal.entries in ARRAY order (the order drizzle actually replays)
 * tracking the running maximum `when`, and reports every entry that sits at
 * or below the maximum established by the entries before it. Such an entry
 * is a latent orphan: the moment any earlier-in-array-but-later-in-time
 * migration is applied to a database, this one becomes permanently
 * unreachable there.
 *
 * Catching it here -- at review time, on the branch that introduces it --
 * is the difference between renumbering one file and discovering years later
 * that a constraint everyone believed was enforced never shipped.
 */
export function findBackwardWhenSteps(journalEntries) {
  const steps = []
  let runningMax = -Infinity
  let runningMaxTag = null
  for (let i = 0; i < journalEntries.length; i++) {
    const entry = journalEntries[i]
    const when = Number(entry.when)
    if (runningMaxTag !== null && when <= runningMax) {
      steps.push({
        arrayIndex: i,
        idx: entry.idx,
        tag: entry.tag,
        when,
        precededByTag: runningMaxTag,
        precededByWhen: runningMax,
      })
    }
    if (when > runningMax) {
      runningMax = when
      runningMaxTag = entry.tag
    }
  }
  return steps
}

// Every backward `when` step that already exists in this repo's history, as
// measured against drizzle/meta/_journal.json on 2026-09-03 (345 entries).
// These are real, already-merged migrations -- three of them (0323, 0328,
// 0344) were the actual orphans this fix repaired; the rest happen to have
// been applied anyway because they were merged before the entry that
// overtook them. They are grandfathered so the gate can be turned on today
// without failing on history it cannot change. A NEW tag appearing in
// findBackwardWhenSteps() is a real defect and fails the build.
//
// Do not add to this list to make a red build green. The fix for a new
// backward step is to give the migration a `when` above the current maximum
// (regenerate it, or edit the journal entry of the not-yet-applied file) --
// which is safe precisely because it has not been applied anywhere yet.
export const KNOWN_PRE_EXISTING_BACKWARD_WHEN_STEPS = new Set([
  "0279_vendor_payment_behavior_dpo_report_definition",
  "0285_ap_payment_proposal_report_definition",
  "0301_construction_prevailing_wage_rates",
  "0315_construction_progress_boq_line_link",
  "0290_fi_ar_004_dunning_list",
  "0312_stage1_preauth_brand_host_lookup",
  "0313_ai_team_role_overrides_rollout",
  "0314_sales_pipeline_module",
  "0344_force_rls_crm_leads_stage_history",
])

export function newBackwardWhenSteps(journalEntries, known = KNOWN_PRE_EXISTING_BACKWARD_WHEN_STEPS) {
  return findBackwardWhenSteps(journalEntries).filter((s) => !known.has(s.tag))
}
