# PROGRESS -- cherry-997-remainder (SD-006 + 6 AP/AR reports, remainder of #997)

## Scope

PR #997 built the same 5 shared calculation-track engines as PR #995
(CO-001, CO-003, FI-GL-002, FI-GL-007, FI-GL-008), plus 6 reports unique to
it: SD-006 (Sales by Material/Service Type) and 6 AP/AR reports (FI-AP-001
Vendor Line Items, FI-AR-001 Customer Line Items, FI-AP-002 Vendor
Balances, FI-AP-003 AP Aging, FI-AR-002 Customer Balances, FI-AR-005
Customer Credit Exposure). #995 was already merged (PR #1497) for the
shared 5 -- this PR hand-applies ONLY #997's unique remainder onto the
now-current main, skipping the 5 already-merged engines entirely to avoid
duplication/conflict.

## Completed
- [x] Fetched PR #997's real source branch
      (`worker/task-20260806-104218-build-extend-calculation-track-engines`),
      verified its HEAD SHA matches GitHub exactly.
- [x] Diffed #997 against its own real merge-base to isolate its true
      30-file scope, then read every touched file's diff function-by-
      function to separate the 5 already-merged shared functions
      (`listJournalEntryLinesByCostCenter`/CO-001,
      `costCenterHierarchyReport`/CO-003 in erp-accounting-service.ts;
      `glAccountBalanceDisplay`/FI-GL-002,
      `glAccountGroupBalancesSummary`/FI-GL-008,
      `subledgerToGlReconciliation`+helpers/FI-GL-007 in
      erp-financial-report-service.ts, plus its FORMULA_REGISTRY entry in
      report-engine-service.ts) from the 7 genuinely unique ones. Confirmed
      by name against current main (post-#1497) that the 5 shared functions
      already exist there -- skipped erp-financial-report-service.ts and
      erp-financial-report-service.test.ts entirely (100% shared-5 content,
      zero unique lines), and skipped the CO-001/CO-003 code already inside
      erp-accounting-service.ts's diff.
- [x] Hand-applied the genuinely unique remainder:
      - `src/lib/services/erp-accounting-service.ts`: +listVendorLineItems
        (FI-AP-001) / +listCustomerLineItems (FI-AR-001) /
        +listJournalEntryLinesByParty helper, +erpSuppliers/erpCustomers
        imports.
      - `src/lib/services/erp-invoicing-service.ts`: +apAgingReport
        (FI-AP-003), +vendorBalances/+customerBalances (FI-AP-002/
        FI-AR-002), +customerCreditExposure (FI-AR-005), +isNotNull import.
      - `src/lib/services/report-engine-service.ts`: +SD-006
        (`aggregateSalesByMaterialServiceType` pure function +
        `salesByMaterialServiceTypeReport` DB wrapper +
        `sales_by_material_service_type` FORMULA_REGISTRY entry),
        +erpSalesInvoiceItems/erpItems/erpItemGroups imports. Verified all
        field names (itemCode/itemName/itemGroupId/standardBuyingRate/
        groupName) against current schema.ts directly, not assumed.
      - `src/lib/services/report-engine-service.test.ts`: +SD-006's full
        `aggregateSalesByMaterialServiceType` test suite (5 tests, pure
        function, no DB).
      - 6 new API routes under `src/app/api/erp/reports/{ap-aging,
        customer-balances,customer-credit-exposure,customer-line-items,
        vendor-balances,vendor-line-items}/route.ts` -- copied verbatim
        from #997 (function names/signatures unchanged).
- [x] Migration-registration gap fixed (this was #997's real, disclosed
      defect: it never registered its 7 migrations in
      `drizzle/meta/_journal.json` at all). Renumbered #997's original
      `0318`-`0324` to genuinely free `0501`-`0507` and registered all 7
      as new `_journal.json` entries.
- [x] `governance-yaml-parse`: clean. `bun test` on touched/new test files:
      `report-engine-service.test.ts` 26/26 pass (5 new SD-006 tests),
      `erp-invoicing-service.test.ts` 61/61 pass (regression check, no
      failures from the new AP/AR functions).
- [x] Manually verified (Windows sandbox's `check-migration-collision.mjs`
      hits the same `import.meta.url`-on-Windows path bug documented below
      for the coverage-gap script -- worked around by checking directly):
      no duplicate migration-number prefix anywhere in `drizzle/`.
- [x] `main` moved twice during this work (PR #1495 governance-script fix,
      then PR #1496 "rebase-1020-v2" platform billing). Re-merged both
      times. The second merge's `drizzle/meta/_journal.json` auto-merged
      INCORRECTLY (git's line-based merge produced a duplicate `idx: 322`
      and a non-contiguous tail, because PR #1496 had inserted its own
      `0400_platform_billing_plans_invoices` entry in the *middle* of the
      sequence, shifting every idx after it) -- caught by re-validating
      idx-contiguity after every merge (not trusting a clean `git merge`
      exit code alone), and fixed by rebuilding the journal from
      `origin/main`'s real authoritative copy plus this PR's 7 entries
      appended after its real tail (idx 323-329), rather than trusting
      git's textual merge of a semantically-ordered JSON array.
      `PROGRESS.md` conflicts (3-way, both re-merges) resolved by
      replace-wholesale each time, per this file's own documented
      one-entry-only convention.
- [x] `tsc --noEmit`: did not complete locally (same pre-existing
      sandbox resource-pressure limitation as PR #1497/PROGRESS.md's own
      prior entry) -- deferred to CI's real Type Check job.

## Remaining
- [ ] Push, open PR, close #997 citing this plan.
- [ ] Wait for real CI, merge if green (same standard as PR #1497 -- treat
      pre-existing/unrelated CI noise, if any, the same way, not blindly).
