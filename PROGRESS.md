# PROGRESS -- task-20260726-172000-hr-performance-error-handling---payroll

V2-17-HR-PERF-VALIDATION: "HR performance/error-handling + payroll rate audit" (CSV rows
#52-#58). Redispatch of a task originally blocked by a spend-governance gate before any
work started; re-verified GENUINELY_STILL_OPEN by the 2026-07-26 triage pass. Claim
registered in `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no collision found with any other active
claim or open PR.

## Completed

- [x] Re-verified the redispatch's triage evidence against the live tree before writing
      any code: confirmed `payroll-engine.ts` takes rates as caller-supplied parameters
      (no hardcoded seed table), confirmed zero HR-dashboard-caching hits under
      `src/lib/services`/`src/app/api/hr`, confirmed no payroll/recruitment/attendance/
      vendor-scorecard load-test script existed anywhere in the tree. All three findings
      still held true.
- [x] Payroll rate-table seed audit: `ai-os/PAYROLL_RATE_SEED_AUDIT_2026-07-26.md`.
      Confirmed there is no hardcoded rate-*seed table* in code (erp_statutory_rules/
      erp_income_tax_slabs are admin-editable master data by design, per Wave 56/68's own
      schema.ts comments) -- the real audit surface is 3 genuinely-hardcoded statutory
      constants in `payroll-engine.ts` (STATUTORY_CAP ₹20L Gratuity Act ceiling,
      EPS_WAGE_CEILING ₹15,000, Bonus Act 8.33-20% bounds), flagged with file:line for a
      real CA/payroll-specialist to verify against the current FY2026-27 notification.
      Also explicitly recorded that the redispatch prompt's "GstRt parity" phrase is a
      cross-reference bleed from an adjacent, separately-tracked decision-log row (C12 /
      CSV #70, e-invoicing) -- not a real V2-17 ask -- rather than silently acting on an
      ambiguous instruction or silently dropping it.
- [x] CA/payroll-specialist verification recorded as deferred in
      `ai-os/REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md` (new "C8 (V2-17)" entry), per this
      task's own constraint that this half stays deferred on a real external reviewer.
- [x] Employees invite/onboarding validation UX cross-check -- 2 real gaps found and fixed:
  - `hr-service.ts`'s `upsertEmployeeProfile` had zero validation on `employmentType`
    (unlike `employmentStatus`, which was already checked) and zero validation on
    `dateOfJoining`/`dateOfBirth` format/sanity. Fixed: extracted a pure
    `validateEmployeeProfileInput()` (testable without a DB, matching this repo's
    established convention) that checks `employmentType` against the 4 documented values,
    validates `dateOfJoining`'s format (future dates legitimately allowed -- onboarding
    ahead of a start date), and rejects a malformed or future `dateOfBirth` (reusing
    `hr-attendance-service.ts`'s existing `isValidDateString`/`assertNotFutureDate`
    helpers rather than reinventing them).
  - `PATCH /api/me/onboarding-stage` accepted any string (or none at all) for `stage`
    with zero validation. Fixed: validates against the 4 known step ids from
    `OnboardingChecklist.tsx`'s own `STEPS` (kept in sync via an explicit code comment,
    UI component itself left untouched since this sandbox has no way to browser-test a
    frontend change -- see the "Load-test harness" note below on the same runtime
    limitation).
  - Added `src/lib/services/hr-service.test.ts` covering every branch of
    `validateEmployeeProfileInput`.
- [x] Caching for HR dashboard KPIs -- there was no HR dashboard KPI aggregation of any
      kind before this task (confirmed by grep across `src/lib/services`/`src/app/api/hr`
      for "kpi"/"dashboard", zero hits). Built:
  - `src/lib/services/hr-dashboard-service.ts` (new): headcount, pending leave requests,
    open job openings, candidates in active pipeline, today's attendance rate, pending
    performance reviews -- behind an in-process 60s TTL cache following
    `asset-registry-cache.ts`'s established convention (in-flight-load dedup, explicit
    invalidation hook, stats observability).
  - `src/app/api/hr/dashboard/route.ts` (new): `GET`, `requireAuth()`-gated.
  - Wired into the existing `src/app/(app)/hr/page.tsx` UI as a KPI card row.
  - `src/lib/services/hr-dashboard-service.test.ts`: unit tests for the extracted pure
    `computeAttendanceRate()` helper (0-headcount → null, not a misleading "0%").
- [x] Load-test harnesses for payroll/recruitment/attendance/vendor scorecards:
      `scripts/hr-payroll-load-test.ts` (new) -- service-layer + DB timing only, no LLM
      calls (unlike `veridian-full-load-test.ts`'s orchestra-layer harness), reusing the
      same shared demo org convention. Covers `listAttendance`/`getMonthlySummaries`
      (attendance), `listApplications`/`listCandidates` (recruitment),
      `listPayrollRuns`/`listPayslips` (payroll -- read paths only; see the doc below for
      why the write path isn't synthesized), `listSupplierScorecards` (vendor), and
      `getHrDashboardKpis` (the new cache, cold vs. warm). **Honest limitation, disclosed
      in `docs/testing/HR_PAYROLL_LOAD_TEST_RESULTS.md`**: this sandbox has no `bun`
      runtime, no `node_modules`, and no `DATABASE_URL` (all confirmed directly) -- the
      harness was authored and reviewed line-by-line against the real current
      service-layer signatures but was **not executed**; no fabricated timing numbers are
      reported. This is a tooling/environment constraint, distinct from the
      spend-governance gate this redispatch specifically checked for -- the harness
      itself costs zero LLM tokens.
- [x] Real finding while building the harness (not just measured, fixed): `erp-buying-
      service.ts`'s `listSupplierScorecards` called `getSupplierScorecard()` in a loop --
      3N sequential queries for N suppliers. Rewritten to fetch each of the 3 source
      tables once for the whole org and group in memory, reusing a shared pure
      `computeSupplierScorecardFromRows()` core. Added
      `src/lib/services/erp-buying-service.test.ts` proving the batched math matches the
      original per-supplier math exactly.
- [x] Claim registered in `ai-os/boss/ACTIVE-CLAIMS.yaml` before opening the PR.

## Remaining

- [x] PR opened: https://github.com/FChecklist/compliance-tracker/pull/583
- [ ] Owner/CA: the deferred rate-verification half (see
      `ai-os/PAYROLL_RATE_SEED_AUDIT_2026-07-26.md` §6 and the V2-6 decisions doc) needs a
      real external CA/payroll-specialist reviewer -- not actionable by this task.
- [ ] Whoever has a real dev environment (bun + DATABASE_URL): run
      `bun run scripts/hr-payroll-load-test.ts` for real and append actual p50/p95 numbers
      to `docs/testing/HR_PAYROLL_LOAD_TEST_RESULTS.md` -- this sandbox could not run it.
- [ ] `src/app/(app)/hr/page.tsx`'s new KPI row was written but not browser-tested (no dev
      server available in this sandbox, per this task's own "start the dev server" UI
      guidance -- honestly flagged as untested-in-browser rather than claimed working).
