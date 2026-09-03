/// <reference types="bun-types" />
// Real automated tests for the E-74 fix (platform.r43_faults fault_id
// E74_MIGRATOR_CURSOR_ORPHANS_MIGRATIONS), against the actual pure functions
// both the migration runner and the CI gate call -- no mocked internals.
//
// The central case is the one that actually happened. On 2026-09-03 the live
// ledger for project pcrjmlpuqsbocqfwoxod had watermark 1787839204000 while
// three journal entries below it had no applied row at all:
//   0323_construction_boq_parent_unique      when=1787412244154
//   0328_erp_customers_active_name_unique    when=1787839200000
//   0344_force_rls_crm_leads_stage_history   when=1785566544899
// Each had been silently skipped by every `drizzle-kit migrate` run since it
// merged, with exit code 0 and no output. Tests 1-3 below prove the
// classification would have caught all three; test 4 proves the DB-free
// preventive gate would have caught 0344 on the pull request that
// introduced it, before it was ever applied anywhere.
import { describe, test, expect } from "bun:test"
import {
  appliedKey,
  ledgerWatermark,
  drizzleWouldApply,
  classifyJournalAgainstLedger,
  findBackwardWhenSteps,
  newBackwardWhenSteps,
  KNOWN_PRE_EXISTING_BACKWARD_WHEN_STEPS,
} from "./migration-ledger.mjs"
import realJournal from "../drizzle/meta/_journal.json"

const entry = (tag: string, when: number, idx = 0) => ({ tag, when, idx, breakpoints: true })

describe("ledgerWatermark", () => {
  test("is the maximum applied created_at, not the last-inserted one", () => {
    // Deliberately unsorted: drizzle sorts by created_at desc, so insertion
    // order must not influence the answer.
    expect(ledgerWatermark([100, 900, 300])).toBe(900)
  })
  test("is null for a genuinely empty ledger -- the fresh-database case", () => {
    expect(ledgerWatermark([])).toBeNull()
  })
  test("ignores non-numeric junk rather than producing NaN", () => {
    expect(ledgerWatermark([100, null, undefined, 500])).toBe(500)
  })
})

describe("drizzleWouldApply -- mirrors PgDialect.migrate()'s gate exactly", () => {
  test("applies everything when the ledger is empty", () => {
    expect(drizzleWouldApply(1, null)).toBe(true)
  })
  test("applies an entry strictly above the watermark", () => {
    expect(drizzleWouldApply(1001, 1000)).toBe(true)
  })
  test("REGRESSION: skips an entry BELOW the watermark -- this is E-74", () => {
    expect(drizzleWouldApply(999, 1000)).toBe(false)
  })
  test("REGRESSION: skips an entry EQUAL to the watermark -- the gate is `<`, not `<=`", () => {
    // Easy to get wrong, and it matters: two migrations generated in the same
    // millisecond would leave the second permanently unapplied.
    expect(drizzleWouldApply(1000, 1000)).toBe(false)
  })
})

describe("classifyJournalAgainstLedger", () => {
  test("REGRESSION: reproduces the three real 2026-09-03 orphans", () => {
    const journal = [
      entry("0322_construction_boq_budget_percentage", 1787412244153),
      entry("0323_construction_boq_parent_unique", 1787412244154),
      entry("0327_crr_p2_schema_drizzle_sync", 1787825814747),
      entry("0328_erp_customers_active_name_unique", 1787839200000),
      entry("0332_r63_fix_auth_user_id_wrong_fk_target", 1787839204000),
      // Merged into a late array position carrying a timestamp ~26 days old.
      entry("0344_force_rls_crm_leads_stage_history", 1785566544899),
      entry("0360_task_assignees", 1787839217000),
    ]
    const ledger = [1787412244153, 1787825814747, 1787839204000]

    const { applied, pending, orphaned, watermark } = classifyJournalAgainstLedger(journal, ledger)

    expect(watermark).toBe(1787839204000)
    expect(applied.map((e) => e.tag)).toEqual([
      "0322_construction_boq_budget_percentage",
      "0327_crr_p2_schema_drizzle_sync",
      "0332_r63_fix_auth_user_id_wrong_fk_target",
    ])
    // The whole point: these three look identical to "not yet applied" in the
    // ledger, and are in fact dead.
    expect(orphaned.map((e) => e.tag)).toEqual([
      "0323_construction_boq_parent_unique",
      "0328_erp_customers_active_name_unique",
      "0344_force_rls_crm_leads_stage_history",
    ])
    // ...while this one is genuinely just new, and must NOT be flagged.
    expect(pending.map((e) => e.tag)).toEqual(["0360_task_assignees"])
  })

  test("after the ledger backfill, the same journal reports zero orphans", () => {
    // Mirrors the repair actually applied on 2026-09-03: the three missing
    // ledger rows inserted, nothing else changed.
    const journal = [
      entry("0323_construction_boq_parent_unique", 1787412244154),
      entry("0328_erp_customers_active_name_unique", 1787839200000),
      entry("0332_r63_fix_auth_user_id_wrong_fk_target", 1787839204000),
      entry("0344_force_rls_crm_leads_stage_history", 1785566544899),
      entry("0360_task_assignees", 1787839217000),
    ]
    const ledger = [1787412244154, 1787839200000, 1787839204000, 1785566544899]
    const { orphaned, pending } = classifyJournalAgainstLedger(journal, ledger)
    expect(orphaned).toEqual([])
    expect(pending.map((e) => e.tag)).toEqual(["0360_task_assignees"])
  })

  test("an empty ledger makes every entry pending, never orphaned", () => {
    // The fresh-database case. Nothing can be orphaned when there is no
    // watermark to be below -- flagging here would break provisioning.
    const journal = [entry("a", 30), entry("b", 10), entry("c", 20)]
    const { applied, pending, orphaned } = classifyJournalAgainstLedger(journal, [])
    expect(applied).toEqual([])
    expect(orphaned).toEqual([])
    expect(pending.length).toBe(3)
  })

  test("string created_at values from the DB driver compare as numbers", () => {
    // postgres.js returns bigint columns as strings. Comparing those with <
    // as strings would silently produce nonsense, so the coercion is load-
    // bearing, not cosmetic.
    const journal = [entry("applied-one", 1787839204000), entry("orphan-one", 1787412244154)]
    const { applied, orphaned } = classifyJournalAgainstLedger(journal, ["1787839204000"])
    expect(applied.map((e) => e.tag)).toEqual(["applied-one"])
    expect(orphaned.map((e) => e.tag)).toEqual(["orphan-one"])
  })

  test("appliedKey reads `when` from a journal entry and `created_at` from a ledger row", () => {
    expect(appliedKey({ when: 42 })).toBe(42)
    expect(appliedKey({ created_at: "42" })).toBe(42)
  })
})

describe("findBackwardWhenSteps -- the DB-free preventive gate", () => {
  test("REGRESSION: catches the 0344 pattern before it is ever applied", () => {
    // This is the check that would have failed the PR that merged 0344:
    // array position 3, timestamp far below everything ahead of it. At that
    // moment the fix is renumbering one file; after merge and one deploy it
    // is a dead migration nobody notices for weeks.
    const journal = [
      entry("0332_r63_fix_auth_user_id_wrong_fk_target", 1787839204000),
      entry("0343_interior_sales_packages", 1787839215000),
      entry("0350_add_org_fk_constraints", 1787839216000),
      entry("0344_force_rls_crm_leads_stage_history", 1785566544899),
    ]
    const steps = findBackwardWhenSteps(journal)
    expect(steps.length).toBe(1)
    expect(steps[0].tag).toBe("0344_force_rls_crm_leads_stage_history")
    expect(steps[0].precededByTag).toBe("0350_add_org_fk_constraints")
    expect(steps[0].arrayIndex).toBe(3)
  })

  test("a strictly increasing journal has no backward steps", () => {
    expect(findBackwardWhenSteps([entry("a", 1), entry("b", 2), entry("c", 3)])).toEqual([])
  })

  test("an EQUAL timestamp counts as a backward step -- it is skipped too", () => {
    const steps = findBackwardWhenSteps([entry("a", 5), entry("b", 5)])
    expect(steps.map((s) => s.tag)).toEqual(["b"])
  })

  test("compares against the RUNNING MAXIMUM, not the immediately previous entry", () => {
    // After a dip, the next entry must still be measured against the high
    // water mark. Comparing only with its neighbour would miss "c" here,
    // which is exactly the shape this repo's journal already has.
    const steps = findBackwardWhenSteps([entry("a", 100), entry("b", 50), entry("c", 60)])
    expect(steps.map((s) => s.tag)).toEqual(["b", "c"])
  })

  test("an empty journal is not an error", () => {
    expect(findBackwardWhenSteps([])).toEqual([])
  })
})

describe("newBackwardWhenSteps", () => {
  test("grandfathers the documented pre-existing steps", () => {
    const journal = [
      entry("0350_add_org_fk_constraints", 1787839216000),
      entry("0344_force_rls_crm_leads_stage_history", 1785566544899),
    ]
    expect(newBackwardWhenSteps(journal)).toEqual([])
  })

  test("REGRESSION: a NEW backward step is not grandfathered and must be reported", () => {
    const journal = [
      entry("0350_add_org_fk_constraints", 1787839216000),
      entry("0344_force_rls_crm_leads_stage_history", 1785566544899),
      entry("0601_some_future_migration", 1000000),
    ]
    expect(newBackwardWhenSteps(journal).map((s) => s.tag)).toEqual(["0601_some_future_migration"])
  })

  test("the grandfather list covers exactly the tags it documents", () => {
    // Guards against someone quietly widening the allowlist: the set is
    // history as measured on 2026-09-03 and should only ever shrink.
    expect(KNOWN_PRE_EXISTING_BACKWARD_WHEN_STEPS.size).toBe(9)
    expect(KNOWN_PRE_EXISTING_BACKWARD_WHEN_STEPS.has("0344_force_rls_crm_leads_stage_history")).toBe(true)
  })
})

describe("the real journal in this repo", () => {
  test("has no NEW backward `when` steps beyond the documented ones", () => {
    // The same assertion CI makes, run against the actual committed journal
    // so a bad migration fails here too, not only in the CI job.
    expect(newBackwardWhenSteps(realJournal.entries)).toEqual([])
  })
})
