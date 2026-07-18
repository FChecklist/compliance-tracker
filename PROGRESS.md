# PROGRESS -- task-20260718-084004-calculation-engine--formula-library---cu

VERIDIAN Review Framework gap-closure: Calculation Engine / Formula Library & Customization (3 findings).

## Investigation summary (read before assuming the findings still hold)

All 3 findings cite `docs/master/CAPABILITY_COVERAGE.md`'s VCEL Computation Engines
table, which said "26 of 211 implemented engines (12.3%) wired into the Chain
Selector" and every industry category (Accounting/Payroll/Inventory/etc.) at 0%.
That doc was accurate when written (2026-07-10) but went stale: waves 165-170
(PRs #164/#165 and follow-ons, already merged to `main` long before this task)
wired 12 more engine categories end to end without this doc being updated to
match. Verified directly from source, not from the doc or the findings:
`Object.keys(WIRED_ENGINE_INPUT_FIELDS)` in `src/lib/services/capability-tree-service.ts`
cross-checked against the `dispatchEngine()` switch in `src/lib/task-execution-engine.ts`.

Real current state (before this PR's own fix): **125 of 211 engines (59.2%)**
already wired into Chain Selector dispatch, across every category except
Manufacturing (still explicitly out of scope, 2026-07-08 decision, unchanged)
and AI Support/Document Processing (100% of their dispatch-ready engines take
array/object input the Chain Selector's UI can't render yet -- same documented
constraint as the 3 Mathematical engines). Every remaining gap in every
category is an existing, individually-commented, deliberate deferral (array/
grid input with no UI support yet, a DB-rule-lookup dependency, or "already a
real product feature/ERP service elsewhere, not re-dispatched as a second
surface") -- not neglect.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no active claim on this area (Chain
      Selector / computation-engine wiring / CAPABILITY_COVERAGE.md); no collision.
- [x] Read `docs/master/CAPABILITY_COVERAGE.md`, `src/lib/services/capability-tree-service.ts`,
      `src/lib/task-execution-engine.ts` in full to verify the findings against
      real current code, per the task's own instruction to check before writing code.
- [x] Verified all 211 implemented engines' wiring status per category, with
      exact counts derived from source (not estimated) -- see the rewritten
      `CAPABILITY_COVERAGE.md` table for the full breakdown.
- [x] Found one genuine small oversight (not a documented deferral like every
      other gap): `loan_schedule_generator`/`amortization_engine` are 2
      registered `computation_engines` rows for the *same* computation as
      `emi_calculator` (`calculateEmi()`), dispatch-ready since Wave 168, but
      never given a Chain Selector leaf. Fixed in
      `src/lib/services/capability-tree-service.ts`: extracted `EMI_FIELDS`
      and assigned it to all 3 keys. Banking Engine goes from 4/9 to 6/9 wired.
      This is a genuine, if small, real closure of the "Reusable Formula
      Library" finding's actual gap (more engines browsable/clickable in the
      Chain Selector), not a documentation-only fix.
- [x] Rewrote `docs/master/CAPABILITY_COVERAGE.md`'s VCEL Computation Engines
      section with the accurate current per-category wired/implemented counts
      (127/211 = 60.2%, after the Banking fix above) and an updated roadmap
      reflecting what's actually still blocking (almost entirely: a richer
      structured-input/grid UI, one single piece of follow-on work, not
      per-category busywork -- Accounting/Payroll/Inventory are NOT still at
      0% as the findings' source doc claimed).
- [x] "Industry Specific Calculation Library" finding: confirmed stale in the
      same pass -- Accounting (25%), Payroll (67%), Inventory (40%), Income Tax
      (100%) are all wired today, not 0%. Manufacturing (11 engines) remains
      out of scope, unchanged, per the existing 2026-07-08 decision -- this
      finding's own gap description already states that as a known fact, not
      something this task was asked to reverse.
- [x] "Custom Formula Builder" finding: confirmed it still does not exist (no
      org-defined, UI-authored formula builder anywhere in the codebase).
      Per the finding's own recommended approach ("lower priority than closing
      the Chain Selector wiring gap... revisit once a concrete customer need
      surfaces via FDE requests"), and finding no evidence of such a customer
      need in `ai-os/MASTER-TRACKER.yaml` or `ai-os/boss/ACTIVE-CLAIMS.yaml`,
      deliberately did NOT build this. Documented here rather than building
      something ahead of demand, consistent with the finding's own guidance.
- [x] Confirmed no touch needed to `src/lib/services/permission-service.ts` or
      any RBAC/`ERP_ACTION_ROLES` surface -- this task's scope (Chain Selector
      calculator wiring) has no access-control dimension of its own.

## Remaining
- [ ] None of the 3 findings require further code changes at this task's
      scope. The one substantive follow-on identified (a richer structured-
      input/grid UI to unlock the ~12 remaining array-input-blocked engine
      categories) is deliberately NOT attempted here -- it's a genuinely
      separate, multi-day UI feature (composer + Chain Selector input-field
      types), not a calculation-engine-wiring fix, and is already called out
      as its own roadmap item in the doc this PR updates.
