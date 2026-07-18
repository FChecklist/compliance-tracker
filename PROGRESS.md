# PROGRESS -- task-20260718-091002-checks---balances--exception-handling

Task: VERIDIAN Review Framework gap-closure for Checks & Balances / Exception
Handling & Recovery -- 4 distinct findings (each listed twice in the
dispatch): Human Override & Approval (HAB-02), Exception Handling Framework,
Automatic Rollback & Recovery, Continuous Internal Controls Monitoring
(AUDIT-03 L3).

## Completed
- [x] Read AGENTS.md/CLAUDE.md, ai-os/CONSTITUTION.yaml's HAB-02/AUDIT-03/GP-29
      entries, and ai-os/boss/ACTIVE-CLAIMS.yaml -- no overlapping active claim;
      registered this task's own claim.
- [x] Re-verified all 4 gaps are still real against current code (not just the
      evaluation's stale description) -- see the claim entry in
      ACTIVE-CLAIMS.yaml for the specific file:line findings that grounded the
      plan below.
- [x] Exception Handling Framework: `ServiceError` (compliance-service.ts)
      extended with a documented `kind` (business|system) / `retryable`
      taxonomy, defaulted from HTTP status so every existing
      `throw new ServiceError(msg, status)` call site classifies itself with
      zero changes required. New `src/lib/services/exception-taxonomy.ts`
      (classifyError/isRetryableError/withAutomaticRecovery) is the named
      framework other services can build on.
- [x] Fixed workspace-memory-service.ts's independent duplicate `ServiceError`
      class (same instanceof-footgun sales-engine-service.ts already got fixed
      for, 2026-07-09) -- now re-exports the canonical class.
- [x] Automatic Rollback & Recovery: `erp-accounting-service.ts` gained
      `voidDraftJournalEntry()` (compensating action -- cancels an orphaned
      draft JE, never deletes financial records). Wired into
      `erp-fixed-assets-service.ts`'s `runDepreciationBatch` (per-row,
      skip-and-continue) and `finalizeAssetDisposal` (rethrow after
      compensating) so a failure AFTER a JE is posted but BEFORE the source
      row is marked done no longer risks a duplicate JE on retry.
- [x] `approval-workflows/steps/[id]/decide/route.ts`: `onWorkflowApproved`/
      `onWorkflowRejected` now run through `withAutomaticRecovery` (one retry
      for retryable/system faults only, per the taxonomy) instead of leaving
      the workflow instance permanently stuck "approved" on a transient
      failure; a still-failing finalize now logs a distinct
      `approval_workflow_instance.finalization_failed` audit event and
      returns a clear, distinguishable error instead of a generic 500.
- [x] Continuous Internal Controls Monitoring: new `src/lib/controls-health-audit.ts`
      (`getControlsHealthSnapshot`) is the L3 Rolling Health Audit -- an
      aggregate query over the rolling window (default 60min, matching the
      constitution's own "30-60min" note) surfacing compensating-void and
      finalization-failure counts. Exposed veridian_admin-gated at
      `GET /api/ai/team/controls-health`, matching the sibling
      `/governance-health` route's convention. Honest limitation documented:
      no automated schedule wired (this repo is already at the Vercel Hobby
      plan's once-per-day cron ceiling, per MASTER-TRACKER.yaml's own prior
      note) -- on-demand/veridian_admin-triggered today, same accepted
      pattern as the review-registry route.
- [x] Human Override & Approval (HAB-02): extracted the one real
      "confirmed boolean -> block execution" gate in the codebase
      (previously inlined in `task-service.ts`'s `createTask`) into a
      reusable `checkHighImpactConfirmation()` in
      `high-impact-action-detector.ts`; `task-service.ts` now calls it
      (zero behavior change, existing tests still cover it). This is the
      first real building block toward the single unified gate HAB-02's
      gap note asks for -- documented in CONSTITUTION.yaml as still
      partial (only one real caller so far), not oversold as a universal
      middleware.
- [x] Updated `ai-os/CONSTITUTION.yaml`: HAB-02, AUDIT-03 (L3 cadence), and
      GP-29 status/mechanism/gap fields updated in this same PR, plus an
      `amendment_log` entry, per the constitution's own amendment_rule.
- [x] Added/updated unit tests for the new pure logic (exception-taxonomy.ts,
      checkHighImpactConfirmation) -- matches this codebase's established
      convention of not unit-testing withTenantContext/DB-backed functions
      from a `.test.ts` file (see erp-fixed-assets-service.test.ts's own
      header comment).
- [x] `bun test`, `bunx tsc --noEmit`, `bun run lint`, `bun run build` all
      clean.
- [x] Opened as PR #430 against main by the original (now-stopped) worker
      dispatcher. Rescued by a later interactive session (task-20260718-180652):
      rebased four times onto origin/main as concurrent sibling PRs (#431,
      #428, and #428's own rescue-registration commit #441) kept merging into
      main mid-rescue -- each time resolving PROGRESS.md/ACTIVE-CLAIMS.yaml
      conflicts by hand (keeping every session's own distinct entries, never
      discarding another session's work) and re-verifying
      `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun run lint`,
      `bun test` all clean after each rebase, posted the structured 8-field
      AUDIT: PASS comment, and confirmed CI green on the final rebased
      commit (all 7 required checks: Lint, Type Check, Build, audit-check,
      Guardrail Presence Check, Asset Registry Coverage Check, Unit Tests).

## Remaining
- [ ] None. TIER1 (no drizzle/*.sql or schema.ts touched) -- merge once CI is
      confirmed green on the final rebased commit.
