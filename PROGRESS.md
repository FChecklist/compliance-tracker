# PROGRESS -- task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown
# PROGRESS -- task-20260727-101145-reporting-api-gateway--external-ai-scope

## Completed
- [x] Read governance docs (CLAUDE.md/AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml), claim
      already registered (`ai-os/boss/ACTIVE-CLAIMS.yaml` line ~43) from invocation 1.
- [x] Built `src/app/api/v1/reports/catalog/route.ts` (GET) -- lists the caller's visible
      report_definitions catalog. Auth via `requireAuthOrApiKey()` + new
      `requireReportsReadAccess()` gate (accepts `read` OR the new `read:reports` scope).
      Zero new execution logic: wraps the existing `getFullReportCatalog({ orgId })`.
- [x] Built `src/app/api/v1/reports/definitions/[id]/run/route.ts` (POST) -- executes a
      report_definitions row via the existing `executeReportDefinition()`. STRICT_TENANT_ISOLATION:
      `orgId` is always `ctx.orgId` from the authenticated caller, never from the request body/query
      (verified by an automated spoofing test, see below). Supports `?format=json|csv|xlsx`.
- [x] `src/lib/report-export-shared.ts` -- server-safe (no browser APIs) `rowsToCSV`/
      `rowsToXLSXBuffer` builders, same `xlsx` package + ExportRow[] convention as
      `report-export.ts`/`reports/page.tsx`, just without the client-side download trigger so an
      API route can return the bytes directly.
- [x] `requireReportsReadAccess()` added to `src/lib/supabase/auth-guard.ts` -- OR-semantics gate
      (broad `read` OR narrow `read:reports`), session always passes.
- [x] `compliance.api_keys.scopes` extended (comma-separated) to accept `read:reports` in
      `POST /api/settings/api-keys` -- no schema/table change needed, the existing free-text
      scopes column already expresses it (`src/lib/db/schema.ts` comment updated to document it).
- [x] `src/lib/openapi/generate.ts` -- documented `/reports/catalog` and
      `/reports/definitions/{id}/run` in the public OpenAPI doc.
- [x] Tests: `catalog/route.test.ts` (3), `definitions/[id]/run/route.test.ts` (6, incl. the
      required tenant-isolation spoofing test + cross-org test), `report-export-shared.test.ts` (5),
      `auth-guard.test.ts` (6 for `requireReportsReadAccess`). All pure-mock, no live DB, matching
      repo convention.
- [x] Fixed bugs found while verifying inherited invocation-1 work: (a) `NextResponse` body-type
      TS error on the raw XLSX `Buffer` (wrapped in `Blob`+`Uint8Array.from`, matching the existing
      `payslips/[id]/pdf/route.ts` fix pattern); (b) test-file cross-contamination between
      `catalog/route.test.ts` and `run/route.test.ts`'s `mock.module()` calls on the same
      `report-engine-service` specifier (both now stub the other file's export too); (c) a test-only
      bug in the CSV-escaping test (was splitting the whole CSV string on `\n`, which broke a
      legitimately-quoted embedded newline); (d) `run/route.test.ts`'s request helper used a plain
      `Request` instead of `NextRequest`, so `request.nextUrl` was undefined for `?format=` tests.
- [x] Full verification pass: `npx tsc --noEmit` clean, `bun test` 2072/2072 passing (repo-wide, not
      just new files), `bun run lint` 0 errors, `node scripts/check-guardrail-presence.mjs` (88/88),
      `node scripts/check-terminology-guardrail.mjs --diff-only` clean (fixed one new hardcoded-date
      finding by rewording, no exemption-registry edit needed), Supabase `get_advisors(security)`
      against the `verdian-ai` project shows only pre-existing findings (views/functions/extensions
      unrelated to `api_keys`/`report_definitions`) -- zero new findings from this change.

## Remaining
- [ ] Write PR description with the real `curl` example (using a real `built`-status report id
      confirmed live via Supabase MCP, e.g. `rptdef_safety_incident`) and the honest note that no
      self-service API-key-creation UI exists yet (only the `POST /api/settings/api-keys` endpoint) --
      flagged as a smaller, non-blocking follow-up per the task spec.
- [ ] Commit, push branch, open PR (expected tier2/HOLD_FOR_OWNER_SIGNOFF per task spec, given
      STRICT_TENANT_ISOLATION is the Owner's top concern for this task -- that classification is
      correct/expected, not something to route around).
# PROGRESS -- task-20260727-132826-fix-pr-597--budget-undercount-roster-gap

Fixing 3 audit-confirmed issues on PR #597 (`worker/task-20260727-122935-timesheet-budget-vs-actual`,
`construction-reports-service.ts`'s new `designerTimesheetReport()`/`aggregateDesignerTimesheetCosts()`),
per the AUDIT: FAIL comment on issue #597. Working directly on that same branch (not a new PR),
per this task's own EXPECTED_OUTPUT.

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (no conflicting active claim found for PR #597 / this file scope).
- [x] Fetched and re-confirmed the audit verdict (`gh api repos/FChecklist/compliance-tracker/issues/597/comments --jq '.[-1].body'`) -- matches this task's KNOWN_CONTEXT exactly.
- [x] Checked out the PR's actual branch (`worker/task-20260727-122935-timesheet-budget-vs-actual`, commit `d08000ce`) to push the fix to the same branch/PR, not open a new one.
- [x] **Fix 1 (budget-undercount / roster-inclusion, the primary blocker):** `aggregateDesignerTimesheetCosts()` now takes an optional 3rd `roster: DesignerTimesheetRosterUser[]` param (`{userId, isActive}[]`, default `[]` for backward compat). `designerStatusByUser` is seeded from `roster` first, then filled in from `entries` for any user not already present -- so a designer with a real `pms_budget_line_items` row but zero time entries anywhere resolves a real active/inactive status and is no longer dropped from `byDesignerStatus`. `designerTimesheetReport()` now passes `allUsers` (already fetched, just mapped to `{userId, isActive}`) into both the org-wide and project-scoped `aggregateDesignerTimesheetCosts()` calls. No other part of the aggregator touched.
- [x] **Fix 2 (N+1 billable-rate resolution):** `designerTimesheetReport()` now fetches `pmsBillableRates` ONCE upfront (`db.query.pmsBillableRates.findMany`) and uses the pure `resolvePmsBillableRatePure(rates, userId, spentOn) ?? 0` inside the per-entry pricing loop, instead of `await resolveBillableRate(...)` (a DB round-trip) once per time entry. Same pattern `pms-invoice-service.ts`'s `buildInvoiceLinesFromTimeEntries` already established. Removed the now-unused `resolveBillableRate` import.
- [x] **Fix 3 (project-scoped vs org-wide field mixing):** chose explicit labeling over full re-scoping (justification: `byDesigner`/`byProject` are inherently org-wide -- a project comparison needs >1 project, and a designer's total budget/actual isn't naturally scoped to one project either -- so full project-scoping would either be meaningless or require a different, narrower feature). Response shape changed from one flat object to `{ projectScoped: { byUser, byCategory, byDesignerStatus, overallBudget, overallActual, overallVariance }, orgWide: { byDesigner, byProject } }`. Confirmed no consumer depends on the old flat shape (report is dispatched generically via `REPORT_REGISTRY`/`report-catalog-service.ts`, which itself notes "No dedicated UI page renders it yet").
- [x] Tests added to `construction-reports-service.test.ts`: 3 new pure-aggregator tests proving the roster-inclusion fix (sum(byDesignerStatus.budget) === overallBudget with an entryless budgeted user; roster doesn't fabricate activity for users with neither entries nor budget lines), plus 1 new DB-mocked integration test (mocks only `withTenantContext` + `requireConstructionEnabled`, same pattern as `tenant-isolation.test.ts`) proving: billable rates fetched exactly once for 30 time entries (not once per entry), the roster fix holds end-to-end, and the response shape is `{projectScoped, orgWide}` not a flat mixed object.
- [x] `ai-os/registry/terminology-guardrail-exemptions.yaml`: added exemption for the 2 new hardcoded-ISO-date test-fixture findings in `construction-reports-service.test.ts` (per Phase 2's established `*.test.ts` directory-scoped exemption).
- [x] Verification: `bun test` -- 2129 pass / 0 fail, full suite (10 pass in `construction-reports-service.test.ts` itself, up from 6). `npx tsc --noEmit` -- 0 errors, full repo (`NODE_OPTIONS=--max-old-space-size=8192`, default heap OOMs on this repo's size). `check-guardrail-presence.mjs` (88/88 markers), `check-terminology-guardrail.mjs --diff-only`, `check-asset-registry-coverage.mjs` -- all pass.

- [x] Pushed both commits (`91c670f3` claim registration, `46d6967d` the actual fix) to `worker/task-20260727-122935-timesheet-budget-vs-actual`. PR #597's head now points at `46d6967d`. Confirmed CI green: `CI`, `Sentinel Governance Checks`, `CodeQL Security Scan` all `success`. `Mandatory Audit Check` shows `failure` -- expected, not a real failure: it's gating on a fresh `AUDIT: PASS`/`AUDIT: FAIL` comment against this new head commit, which hasn't been re-triggered yet.

## Remaining
- [ ] Requires a fresh supervisor audit before merge (`veridian-task.py adopt`) -- this PR was already adopted once as task-20260727-131559; needs re-triggering after this fix lands, per this task's own EXPECTED_OUTPUT. `Mandatory Audit Check` will stay red until that lands.
- [ ] Move this session's `ai-os/boss/ACTIVE-CLAIMS.yaml` entry to `recently_completed:` once the re-audit passes and the PR merges.

# PROGRESS -- task-20260727-100954-erp-hr-gaps--expense-reimbursement--loan

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting (no conflicting active claims found).
- [x] Fixed the stale `hr-service.ts:1-6` "Payroll deliberately out of scope" comment (was already wrong -- `erp-payroll-service.ts` is a real, live payroll engine).
- [x] **Gap 1: Employee expense claims/reimbursement.** New `hrExpenseClaims` table (schema.ts), `hr-expense-service.ts` (create/list/decide), `src/app/api/hr/expenses/route.ts` + `[id]/route.ts`. Payroll integration decision: an approved-but-unpaid claim is picked up by `processPayrollRun()` as a real payslip **earning** line (not a separate payment record) -- reuses the existing payslip/net-pay machinery, documented in schema.ts's own comment.
- [x] **Gap 2: Employee loans/salary advances.** New `hrEmployeeLoans` + `hrLoanInstallments` tables, `hr-loan-service.ts` (request/approve-generates-full-schedule/reject), `src/app/api/hr/loans/route.ts` + `[id]/route.ts` + `[id]/installments/route.ts`. Payroll integration: `processPayrollRun()` deducts the earliest still-pending installment on every processed run (one per run, in installment-number order -- documented simplification, does not match calendar dueMonth/dueYear against the run's own month/year), decrements `outstandingBalance`, closes the loan at 0.
- [x] **Gap 3: KRA/weighted-goal + multi-rater (360) appraisal.** Extended (not replaced) `performanceReviews`/`performance-service.ts`: new `performanceReviewGoals` (per-goal weight+rating, `computeWeightedScore` pure helper enforces weights sum to 100), new `performanceReviewRaters` (peer/subordinate/other, additive to the existing self+manager pair), new nullable `performanceReviews.weightedScore` column (computed on submit only if goals exist -- zero-goal reviews unchanged). Routes: `.../reviews/[id]/goals/route.ts` + `[goalId]/route.ts`, `.../reviews/[id]/raters/route.ts` + `[raterId]/route.ts`.
- [x] **Gap 4: Shift management/roster.** New `hrShiftTypes` + `hrShiftRosterAssignments` tables, `hr-shift-service.ts` (`resolveShiftForDate` pure helper + CRUD), new nullable `hrAttendanceRecords.shiftTypeId` column -- `checkIn`/`markAttendance` in `hr-attendance-service.ts` now snapshot the resolved expected shift at write time. Routes: `src/app/api/hr/shifts/route.ts` + `roster/route.ts`.
- [x] Drizzle migration `drizzle/0264_hr_gap_closure_expense_loan_appraisal_shift.sql` (all 7 new tables + 2 additive columns, org-scoped RLS+FORCE+policies+grants+indexes, matching drizzle/0050's own pattern) + `drizzle/meta/_journal.json` entry.
- [x] `ai-os/registry/asset-registry-coverage.yaml`: all 7 new tables given an explicit `exempted` decision with a real per-table reason (sensitive per-employee financial/performance data, or a ledger/log record with no genuine display-name column -- same classes as the already-exempted `performance_reviews`/`hr_attendance_records`/`crm_stage_history`).
- [x] `ai-os/registry/terminology-guardrail-exemptions.yaml`: 8 new files given real per-file exemption entries (dated changelog-comment + test-fixture-date-literal false positives, same class Phase 2 already established for this directory).
- [x] Tests: `hr-loan-service.test.ts`, `hr-shift-service.test.ts`, `hr-expense-service.test.ts`, `erp-payroll-service.test.ts` (proves a processed payroll run reflects both the loan deduction and the expense reimbursement, per this task's own SUCCESS_CRITERIA), `performance-service.test.ts` -- all pure-function tests (no live DB in `.test.ts`, matching this repo's established convention).
- [x] Verification: `bun test` -- 2073 pass / 0 fail (full suite, no regressions) + 63 pass / 0 fail (new + touched files run standalone). `bunx tsc --noEmit` -- 0 errors, full repo. `check-asset-registry-coverage.mjs`, `check-terminology-guardrail.mjs --diff-only`, `check-guardrail-presence.mjs` -- all pass.

## Remaining
- [ ] `get_advisors(security)` via Supabase MCP -- not run this pass (no live Supabase project connected in this session; the MCP server requires interactive OAuth authorization this non-interactive session cannot complete). RLS+FORCE+policies were hand-written to mirror `drizzle/0050`'s already-audited pattern exactly, but the SUCCESS_CRITERIA's explicit zero-new-findings check itself is unverified -- flag for the merging session/owner to run before/at merge.
- [ ] Push commits, open the PR, and get the mandatory independent audit-verdict comment (AGENTS.md Rule 6/7(c)/10) -- this session must not self-merge.
- [ ] Optional follow-up (not required by this task's SUCCESS_CRITERIA, noted honestly): no UI screens were built for any of the 4 features (API + service + schema only, matching this task's own SCOPE wording) -- a real, separate future gap if the Owner wants employee-facing UI for these before the next HR wave.
# PROGRESS -- task-20260727-101123-erp-project-management-gaps--timesheet-t

## Completed
- [x] Gap 1 -- PMS timesheet -> client invoice: `src/lib/services/pms-invoice-service.ts`
  (`generateInvoiceFromUnbilledProjectTime`), modeled on
  `firm-billing-service.ts`'s `generateInvoiceFromUnbilledTime()`. Reuses the
  existing `erp_sales_invoices`/`erp_sales_invoice_items` schema/service --
  no new invoice table. Added 3 additive columns to `pms_time_entries`
  (`billable`, `hourlyRateSnapshot`, `invoiceItemId`) mirroring
  `firm_time_entries`'s existing trio, migration
  `drizzle/0264_pms_timesheet_invoice_link.sql` (hand-authored -- see note
  below on why `drizzle-kit generate` wasn't used). `requireAuth()`-gated
  route: `POST /api/pms/invoices/generate`. Pure-function unit tests:
  `pms-time-service.test.ts` (rate resolution), `pms-invoice-service.test.ts`
  (line-building, rounding, missing-rate error, org-default fallback).
- [x] Gap 2 -- Gantt/critical-path UI: **already existed, no changes made.**
  Confirmed `getGanttData()` (`schedule-service.ts`) already returns
  `isCritical`/`floatDays` per task via `calculateCriticalPath()` -- did NOT
  extend it. Confirmed PROJEXA (`FChecklist/projexa`) already has a real,
  merged Gantt UI consuming `GET /api/v1/projexa/schedule/gantt`:
  `src/components/ScheduleGanttClient.tsx` + `src/app/(app)/schedule/page.tsx`
  (Timeline tab), proxied via `src/app/api/schedule/gantt/route.ts`, merged
  2026-07-09 as commit `e1572a4` on `origin/main` -- shows critical path as a
  grid column (isCritical/floatDays), a stats bar, and Capture Baseline.
  The task SPEC's KNOWN_CONTEXT claim of "zero .tsx Gantt matches" was based
  on grepping compliance-tracker itself, which has no UI at all (correct,
  but not the relevant repo) -- the real UI lives in the separate PROJEXA
  repo and was already shipped 18 days before this task's Phase 0
  investigation. No PROJEXA PR opened -- there is nothing to change.
- [x] Gap 3 -- Resource-allocation conflict/over-allocation detection:
  `detectResourceConflicts()`/`getResourceConflicts()` added to
  `schedule-service.ts`. Existing `getWorkload()` was scoped to a SINGLE
  project only -- the real, previously-undetected gap is a user who looks
  fine in every individual project's workload view while being double-/
  triple-booked once their allocations across ALL of an org's projects are
  summed for the same day. New pure function sums `allocatedHoursPerDay`
  per user per calendar day across every project passed in. Wired to:
  - `GET /api/pms/schedule/resource-conflicts` (compliance-tracker,
    `requireAuthOrApiKey`, which calls `requireAuth()` internally --
    same convention as every other route in `/api/pms/schedule/*`)
  - `GET /api/v1/projexa/schedule/resource-conflicts` (PROJEXA-facing v1
    surface, same convention as sibling `gantt`/`workload` routes)
  - `POST /api/pms/schedule/resource-allocations` and
    `POST /api/v1/projexa/schedule/workload` now both return a `conflicts`
    array in their response immediately after creating an allocation.
  Unit tests: `schedule-service.test.ts` -- deliberately-constructed
  overlapping over-allocation (flagged, correct total + project attribution,
  correct date-range boundary), non-overlapping legitimate case (not
  flagged), two-under-capacity-users case (not flagged), exactly-at-capacity
  boundary (not flagged, only strictly over), custom capacity override.

- `bunx tsc --noEmit` clean (0 errors) across the whole compliance-tracker
  repo -- confirmed via `NODE_OPTIONS="--max-old-space-size=8192"` (default
  heap OOMs on this repo's size in this sandbox; that's a sandbox-memory
  fact, not a code issue).
- `bun test` on all new/touched service test files: 17 pass / 0 fail.
- Migration numbering: `drizzle-kit generate` produced a full-schema dump
  (not an incremental diff) because this repo's `drizzle/meta/` only keeps
  a `0000_snapshot.json` baseline -- migrations 0001-0263 are hand-authored
  SQL with journal entries only, no per-migration snapshot. Followed that
  established convention: hand-wrote `drizzle/0264_pms_timesheet_invoice_link.sql`
  (ALTER TABLE + forward-referenced FK + index, same shape as
  `drizzle/0086`'s `firm_time_entries.invoice_line_item_id`), manually
  appended `drizzle/meta/_journal.json`. `node scripts/check-migration-collision.mjs`
  passes. **Not applied live** -- left for the supervising session/owner,
  same convention drizzle/0262 and drizzle/0263 already used for untested
  migrations in this repo.

## Remaining
- [ ] Real live-DB verification of the migration + invoice generation flow
  (this session only has pure-function unit coverage, per this repo's own
  "no live DB in .test.ts" convention -- confirmed via
  `erp-payment-entries-service.test.ts`'s own header note).
- [ ] Open the compliance-tracker PR (branch already pushed) and get the
  independent (non-self) audit comment per AGENTS.md Rule 7(c)/Rule 10.
- [ ] No PROJEXA PR needed (see Gap 2 above) -- confirm with owner this is
  understood as "nothing to build," not "skipped."
# PROGRESS -- task-20260727-093117-fix-dependabot-alert34-sharp-cve

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no collision, registered claim
- [x] Explored existing code: constructionBoqLineItems schema, construction-boq-service.ts,
      erp-invoicing-service.ts (createSalesInvoice -- reused for interim-bill invoice emission,
      NOT firm-billing-service.ts's firm_invoices, since erpSalesInvoices already has a
      projectId column from Wave 120 PROJEXA Revenue Report -- confirmed by
      construction-dashboard-service.ts already reading it for per-project revenue),
      spreadsheet-adapter.ts/column-mapper.ts/ingest/parser.ts (Excel import pattern)
- [x] bun was missing from this sandbox (only bunx existed) -- installed via bun.sh/install,
      added to PATH; `bun install` ran clean (1220 packages)
- [x] Schema: added parentLineItemId + breakdownPercentage to constructionBoqLineItems;
      new constructionInterimBills + constructionInterimBillLineItems tables + relations
- [x] Migration drizzle/0265_construction_boq_hierarchy_interim_billing.sql -- HAND-WRITTEN,
      not raw drizzle-kit output: discovered drizzle/meta/ is missing every per-migration
      snapshot from 0001-0264 (only 0000_snapshot.json ever committed -- a prior repair
      commit fixed _journal.json's tags but not the snapshots), so `drizzle-kit generate`
      diffs against a near-empty baseline and tries to recreate the entire 457-table schema.
      Wrote a minimal correct migration by hand instead (ALTER TABLE x2 + CREATE TABLE x2 +
      indexes + RLS, modeled on 0101_wave115_construction_boq_progress_diary.sql's exact
      conventions) and kept the freshly-generated 0265_snapshot.json (verified accurate: 457
      tables, has the new columns/tables) as the new baseline for future `generate` calls.
      Did NOT attempt to backfill the other 264 missing historical snapshots -- out of scope.
- [x] construction-boq-service.ts: computeHierarchicalAmount() (root-Main-based formula,
      handles multi-level nesting + circular-ref/missing-parent errors), insertLineItems()
      rewritten for parent-before-child topological insert order (real DB ids for
      parentLineItemId), diffLineItems() extracted as a pure hierarchy-aware diff
      (breakdownPercentageChange + isSubItem flag)
- [x] construction-boq-service.test.ts: 11 tests, all passing -- exact Owner formula
      (40/35/25% summing to main amount), multi-level nesting, circular-ref/missing-parent
      errors, diff detecting breakdown-%-only changes

- [x] construction-valuation-service.ts: interim/RA billing + retention % + invoice emission
      via erp-invoicing-service.ts's createSalesInvoice (reuses erpSalesInvoices, not a new
      table). 10 pure-function tests, all passing.
- [x] Verified existing /api/construction/boq and /api/v1/construction/boq routes need no
      changes -- they already pass the request body straight through to
      createBoq/createBoqRevision, so parentItemCode/breakdownPercentage flow through
      transparently.
- [x] New API routes: GET/POST /api/construction/interim-bills, GET
      /api/construction/interim-bills/[id], POST /api/construction/boq/import (multipart
      xlsx/csv upload -> parse -> createBoq or createBoqRevision)
- [x] Excel BoQ importer: construction-boq-import-service.ts + API route. 5 tests including
      a real in-memory xlsx buffer parsed end to end.
- [x] npx tsc --noEmit clean (had to raise Node heap via NODE_OPTIONS=--max-old-space-size,
      default heap OOMs on this project's size), bun test: 2128 pass / 0 fail (full suite,
      no regressions), eslint clean on all new/changed files

## Corrective fix (task-20260727-132748, post-audit, 2026-07-27)
- [x] **Disclosure gap (audit finding, not caught/flagged at the time):** the original
      generateInterimBill() built invoice line items (billable BoQ lines + a negative
      "Retention held" line) that never set taxTemplateId, and erp-invoicing-service.ts's
      computeInvoiceTotals() only applies tax when a line explicitly carries one -- no
      company/customer-level fallback exists anywhere in this codebase (checked
      erpCustomers/erpCompanies/erp-invoicing-service.ts). Every interim/RA bill this
      feature generated therefore posted with $0 GST/tax by default. Not caught by the
      original pure-function unit tests (they never asserted on tax fields) and not
      disclosed in this file's Remaining section at the time, unlike the migration-not-
      applied and get_advisors gaps below which were. Confirmed by an independent audit
      (AGENTS.md Rule 7(c)/10) on PR #596, verdict FAIL.
- [x] Fix: `GenerateInterimBillInput` now requires a real `taxTemplateId`
      (`construction-valuation-service.ts`), validated to exist and belong to the org before
      any bill is generated (no silent zero-tax default, no invented company/customer-level
      fallback since none exists in this codebase). Every billable invoice line now carries
      it via the new pure `buildInterimBillInvoiceItems()` helper.
- [x] Fix: retention is no longer emitted as a negative invoice line item (which reduced the
      invoice's taxable subtotal, compounding the tax gap once wired in). GST is due on the
      full value of work certified regardless of retention terms, so every invoice is now
      raised for the full gross amount with tax computed on that same gross value; the
      retention holdback continues to be tracked exactly where it already was --
      `constructionInterimBills.retentionAmount`/`netPayable` -- entirely separate from the
      invoice. No new schema/migration needed: that holdback tracking already existed, the
      bug was double-encoding it into the invoice too.
- [x] `erp-invoicing-service.ts`'s `computeInvoiceTotals()` split into a pure
      `computeInvoiceTaxTotals()` (tax math over already-resolved rates) + a thin DB-fetching
      wrapper, mirroring this repo's existing pure-function-core convention -- makes the tax
      math independently testable without a live DB (same reasoning as
      `computeInterimBillLines`/`applyRetention`).
- [x] Tests: `construction-valuation-service.test.ts` (`buildInterimBillInvoiceItems` -- no
      negative retention line, every item carries the real taxTemplateId, sum of item rates
      equals the undiminished gross) + new `erp-invoicing-service.test.ts`
      (`computeInvoiceTaxTotals` -- real nonzero tax on a real template's rates, and proof
      that removing the retention line keeps the taxable subtotal at the full gross instead
      of the old negative-line amount). `npx tsc --noEmit` clean, `bun test` full suite
      passing, no regressions.
- [x] Minor pre-existing-pattern gap (bill numbering race, `max(billNumber)+1` read-then-
      insert) intentionally NOT touched this pass -- matches an existing convention elsewhere
      (`erpSalesInvoices.invoiceNumber`), not a regression introduced by this feature, and
      explicitly out of this task's scope per its own CONSTRAINTS.

## Remaining / handed back to the Owner
- [ ] This task's migration (drizzle/0265_*.sql) has NOT been applied to any live Supabase
      project (verdian-ai / evpckeuxgvahguwsaeul). Applying a migration to production is a
      not-cleanly-reversible action outside a worker session's authority per this repo's own
      deploy-gate convention (AGENTS.md Rule 7(e)) -- needs the Owner's explicit go-ahead, same
      as every other schema change in this repo's history that touched a live project.
- [ ] Because the migration is unapplied, `get_advisors(security)` has NOT been run
      post-migration (running it now would only show the pre-existing baseline, not evaluate
      the new tables' RLS -- and applying the migration itself requires the sign-off above).
      The new tables' RLS policies were hand-verified against
      0101_wave115_construction_boq_progress_diary.sql's exact established pattern instead
      (tenant-isolation policy on construction_interim_bills directly by org_id; EXISTS-join
      policy on construction_interim_bill_line_items via its parent, matching
      construction_boq_line_items' own policy shape).
- [x] Open PR -- PR #596, `worker/task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown`
- [ ] This corrective push needs a fresh supervisor audit (the original audit's FAIL verdict
      required a re-audit after corrective changes, per this task's own protocol) before it
      can go to Owner sign-off -- tier2, do not merge without that.
