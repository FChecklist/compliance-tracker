# PROGRESS -- task-20260718-061005-ai-cost-governance---finops--cost-contro

VERIDIAN Review Framework gap-closure: AI Cost Governance & FinOps / Cost Controls & Budgets.

Read the actual current implementation first (cost-guard.ts, metric-alert-service.ts,
org-provisioning-service.ts, organisations schema) before writing anything -- both gap
descriptions still matched live code as of 2026-07-18. No conflicting active claim in
ai-os/boss/ACTIVE-CLAIMS.yaml for this area.

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml -- no conflicting claim on cost-guard.ts,
      metric-alert-service.ts, or org-provisioning-service.ts
- [x] [Medium] Cost ceiling breach alert: added `checkCostCeilingBreaches()` +
      pure `classifyCostBreach()` to `src/lib/cost-guard.ts`. Iterates orgs with
      `costCapEnforcementEnabled=true` and `monthlyCostCapUsd` set, computes spend via
      the existing `getCostStatus()`, and pushes a `notifications` row (type "system",
      matching metric-alert-service.ts's own notify-on-breach shape) to that org's
      admin/manager-role users on "near" (>=80%) or "over" limit -- same threshold
      cost-guard.ts already defined, just never surfaced proactively before.
      Wired in as a 5th consumer of the existing daily
      `/api/internal/metric-alerts/run` cron (vercel.json: `0 5 * * *`), alongside
      the already-established checkTicketSlaBreaches/checkTaskOverdue/
      reprioritizeTasks/evaluateAllMetricAlertRules -- reuses that file's exact
      alerting pattern (per the task's recommended approach) rather than building a
      new cron/mechanism. Deliberately re-notifies every run while a breach persists,
      matching checkTicketSlaBreaches/checkTaskOverdue's own existing no-dedup
      precedent in this codebase (consistent daily cadence, not new spam).
- [x] [High] Free-tier/trial AI spend cap: `src/lib/services/org-provisioning-service.ts`'s
      `provisionOrganisation()` (the single shared org-creation path for both the
      human-signup flow and the service-to-service `/api/v1/platform/provision-org`
      flow -- confirmed by reading both call sites, neither passes a `plan`, every org
      created today is "free") now sets a real `monthlyCostCapUsd` at creation time via
      a new `defaultMonthlyCostCapUsdForPlan(plan)` helper ($20/mo for "free", null/
      unenforced for any other plan value) plus `costCapEnforcementEnabled: true`.
      Org-creation-time default keyed on plan/tier, not a blanket update to existing
      organisations rows -- every pre-existing org's `monthlyCostCapUsd` (null,
      unenforced) is untouched; only newly-created orgs get the default going forward.
- [x] Added `src/lib/cost-guard.test.ts` (classifyCostBreach: over/near/none, over
      takes priority) and `src/lib/services/org-provisioning-service.test.ts`
      (defaultMonthlyCostCapUsdForPlan: free -> 20, pro/enterprise -> null) --
      DB-free unit tests of the pure decision cores, matching this codebase's
      established convention (task-service.test.ts's isTaskOverdue, etc.) of not
      exercising the DB-touching cron-entry functions directly in .test.ts files.
- [x] Verification: `bun test` (full suite) 1426 pass / 0 fail; `bunx tsc --noEmit`
      clean; `bunx eslint` clean on every changed/new file; `bun run build` green;
      `node scripts/check-guardrail-presence.mjs` passed (88/88 markers, unaffected).
- [x] Did not touch `permission-service.ts`'s `ERP_ACTION_ROLES` table or any other
      in-flight worker's declared scope -- this task's changes are entirely within
      cost-guard.ts / org-provisioning-service.ts / the metric-alerts cron route.

## Remaining
- [ ] None -- both findings closed. Registering completion in
      ai-os/boss/ACTIVE-CLAIMS.yaml is the one remaining housekeeping step, done
      alongside this commit per that file's own protocol.
