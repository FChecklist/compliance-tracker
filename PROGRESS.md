# PROGRESS -- task-20260718-082004-crm---sales-modules--sales-pipeline

VERIDIAN Review Framework gap-closure: CRM & Sales Modules / Sales Pipeline (14 findings).

## Already resolved before this task (verified live, findings were stale)
- `getSalesPipelineOverview()` (crm-service.ts) and the `/api/v1/projexa/sales-pipeline`
  external-API alias were already fully implemented (leadsByStatus, opportunitiesByStage,
  winRate, openPipelineValue, overdue follow-up counts). Not rebuilt.

## Completed
- [x] **Data Model Completeness & Referential Integrity** -- new org-scoped `crm_pipeline_stages`
      config table (drizzle/0313), lazily auto-seeded per org with the 5 pre-existing hardcoded
      stage strings (`listPipelineStages()`), so no data migration/backfill needed and behavior
      is unchanged for every org that hasn't touched pipeline config. CRUD routes under
      `/api/crm/pipeline/stages` (manager-gated). Registered in `asset-registry-coverage.yaml`
      (`registered`, not `exempted` -- has a genuine `label` display-name column).
- [x] **Business Rule & Validation Accuracy** -- `isValidStageTransition()` (pure, unit-tested,
      10 tests) wired into `updateOpportunity()`. A deal can move freely between any two
      non-terminal stages (including backward); moving OUT of a closed (won/lost) stage requires
      manager rank. The UI's plain `<Select>` previously allowed any jump silently.
- [x] **Multi-Tenant / Multi-Project Isolation** -- re-verified: `crm_pipeline_stages` carries
      `org_id` + `FORCE ROW LEVEL SECURITY` + the standard `app_runtime_org_scoped` policy,
      identical to `crm_accounts` (drizzle/0219). No isolation gap introduced.
- [x] **Reporting & Export Accuracy** -- new `sales-pipeline-overview` entry in `REPORT_CATALOG`
      (new `"CRM"` `ReportDomain`, gated to the existing `sales` product branch via
      `report-domain-enablement-service.ts` -- NOT mislabeled as `"ERP"`). CSV export route at
      `GET /api/crm/pipeline/export`.
- [x] **AI Copilot / Worker Agent Integration Depth** -- `getPipelineAiSummary()`, a new
      pipeline-level AI insight ("which deals are at risk this quarter") aggregating across the
      open funnel, following `analyzeOpportunity()`'s existing 6-step orchestration pattern
      (enforcePolicy -> resolveModelConfig -> resolvePromptTemplate -> callLLMJson ->
      recordOrchestraExecution). New `crm_intelligence.pipeline_summary` prompt template
      (drizzle/0313). Ephemeral (not persisted) -- no single entity row to cache it against.
      Surfaced via a "Pipeline Insight" button on the new Kanban tab.
- [x] **Search, Filter & Bulk Operations** -- search box + owner filter on the new Kanban view;
      multi-select + bulk-reassign toolbar wired to the pre-existing `bulkReassignOpportunities()`
      service function via a new native route (`POST /api/crm/opportunities/bulk-reassign` --
      previously only reachable via the external `/api/v1/projexa` alias, zero in-app consumer).
- [x] **Error Handling & Data Validation Messaging** -- illegal stage-transition drags revert
      optimistically and surface the server's real `ServiceError` reason via toast, not a silent
      no-op or generic failure message.
- [x] **Cross-Module Integration Consistency** -- the new Pipeline tab is the first real in-app
      consumer of `getSalesPipelineOverview()`/`listPipelineStages()`, proving out the
      client-side composition the code comment referenced.
- [x] **Notification & Alert Trigger Correctness** -- new `pipeline-stuck-deal-digest-service.ts`
      (mirrors `task-nudge-digest-service.ts`'s exact shape: platform-wide cron, one batched
      notification per deal owner, zero LLM call). "Stuck" = 30+ days in current stage per
      `crm_stage_history`'s latest row for that opportunity. Cron registered in `vercel.json`
      (`45 9 * * *`). `GET /api/crm/pipeline/stuck` surfaces the same list in the UI (badge per
      card).
- [x] **Documentation & In-App Help Coverage** -- the Pipeline tab itself (with inline empty/
      loading states and a labeled AI insight panel) is the documentation surface the finding
      said didn't exist because no UI existed; this PROGRESS.md entry + the code's own header
      comments serve as the technical documentation. No separate user-help article written this
      wave -- flagged as a real gap, not silently dropped (see Deferred below).
- [x] **Data Import/Export Template Fidelity** -- CSV **export** implemented
      (`GET /api/crm/pipeline/export`, includes stage label, value, currency, exchange rate,
      owner, AI win probability). **Import is explicitly deferred** (see below) -- a real
      round-trippable import needs unknown-ownerId/unknown-stage validation and dedup logic that
      is genuinely more scope than fits this wave; noted here rather than silently dropped.
- [x] **Localization Readiness** -- `crm_opportunities.currency_id`/`exchange_rate` columns added
      (drizzle/0313, identical shape to drizzle/0208's fix for `erp_quotations`/
      `erp_sales_orders`). `exchangeRate` defaults to `'1'` so every pre-existing row keeps
      reading as "org base currency, rate 1" -- zero behavior change until an opportunity is
      explicitly given a foreign currency. `getSalesPipelineOverview()`'s aggregates now sum
      `estimatedValue * exchangeRate` (base-currency rollup) instead of naively summing mixed
      currencies.

## Explicitly out of scope / deferred (documented, not silently dropped)
- **Audit Trail & Change History**: `crm_stage_history` already logs every stage/status
  transition (who/when/from/to) for both leads and opportunities -- verified this is real and
  working, so it already IS the pipeline's audit trail for the dimension this finding names.
  Did **not** retrofit the generic `audit_logs` table (via `logActivity()`) onto every existing
  `createLead`/`updateLead`/`createOpportunity` call -- that is a broader "Leads/Opportunities"
  audit-trail completeness fix (create/delete events beyond stage change), not specific to
  Sales Pipeline, and touching that much of `crm-service.ts`'s shared surface risked colliding
  with a concurrently-active session (see `ACTIVE-CLAIMS.yaml`'s CRM Accounts/Contacts RBAC
  entry). Flagged as a real follow-on, not claimed as done.
- CSV **import** for opportunities (see above).
- A dedicated `Reports & Analysis` help article for the new catalog entry.
- Full RBAC pass on `/api/crm/leads`/`/api/crm/opportunities` CRUD routes (currently
  role-unchecked beyond org membership) -- out of the 14 findings this task was scoped to; only
  the one genuinely new action this wave introduces (`crm.pipeline_stages.manage`) got a
  permission-service.ts entry, added additively per the task's own instruction.

## Verification performed
- `bun test src/lib/services/crm-service.test.ts` -- 10/10 pass (isValidStageTransition, all
  branches: forward/backward/no-op/close-from-any-role/reopen-requires-manager/unknown-stage/
  defensive fallback).
- Targeted review of every touched file for type correctness; the new `ReportDomain` value
  ("CRM") required updating 4 `Record<ReportDomain, ...>` exhaustive maps
  (`report-catalog-service.ts` x2, `report-engine-service.ts`, `capability-tree-service.ts`,
  `ReportCatalogList.tsx`) -- all fixed. A full whole-repo `bunx tsc --noEmit` run in this
  sandbox hits an OOM/timeout on unrelated pre-existing files (missing `@types/node` in
  `scripts/`, etc.) even with an increased heap -- inconclusive on a full pass; real CI
  (`bun run build`/lint) is the actual gate and has not run yet as of this checkpoint.
- Not run in this sandbox (no live `DATABASE_URL`): the drizzle/0313 migration itself, and any
  route requiring a live DB. Migration SQL follows this repo's own established, previously-
  applied pattern (drizzle/0219 crm_accounts, drizzle/0208 currency columns) closely enough to
  be low-risk, but has not been executed against a real database by this session.

## Files touched
- `drizzle/0313_sales_pipeline_module.sql` (new migration)
- `src/lib/db/schema.ts` (crmPipelineStages table; crmOpportunities.currencyId/exchangeRate)
- `src/lib/services/crm-service.ts` (pipeline stage CRUD, isValidStageTransition,
  listStuckOpportunities, getPipelineAiSummary, currency-aware overview, stage-transition
  enforcement in updateOpportunity)
- `src/lib/services/crm-service.test.ts` (new)
- `src/lib/services/pipeline-stuck-deal-digest-service.ts` (new)
- `src/lib/services/permission-service.ts` (additive: `crm.pipeline_stages.manage`)
- `src/lib/services/report-catalog-service.ts` (new `CRM` ReportDomain, new catalog entry)
- `src/lib/services/report-domain-enablement-service.ts` (+.test.ts) (CRM -> `sales` branch gate)
- `src/lib/services/report-engine-service.ts` (Record<ReportDomain> exhaustiveness)
- `src/lib/services/capability-tree-service.ts` (Record<ReportDomain> exhaustiveness)
- `src/components/ReportCatalogList.tsx` (Record<ReportDomain> exhaustiveness)
- `src/components/crm/PipelineKanbanBoard.tsx` (new)
- `src/app/(app)/crm/page.tsx` (new "Pipeline" tab)
- `src/app/api/crm/pipeline/{stages,stages/[id],export,ai-summary,stuck}/route.ts` (new)
- `src/app/api/crm/opportunities/bulk-reassign/route.ts` (new)
- `src/app/api/crm/opportunities/[id]/route.ts` (thread actorRole through to updateOpportunity)
- `src/app/api/internal/pipeline-stuck-deal-digest/run/route.ts` (new)
- `vercel.json` (new cron entry)
- `ai-os/registry/asset-registry-coverage.yaml` (crm_pipeline_stages registered)
- `ai-os/boss/ACTIVE-CLAIMS.yaml` (claim registered at task start)

## Remaining
- [x] Open a PR against `main` (branch protection + CI gate per AGENTS.md Rule 6) --
      **PR #1018** opened (https://github.com/FChecklist/compliance-tracker/pull/1018).
- [x] Branch had drifted 788 commits behind `main` since this task's original checkpoint
      (2026-08-07) -- zero CI check-suite had even been created for the original push
      (`mergeable: CONFLICTING`). Unshallowed the clone (`git fetch --unshallow`), merged
      `origin/main`, and resolved 9 conflicted files by hand (merge commit `1429f1fbc`):
      - `PROGRESS.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml`, `ai-os/registry/asset-registry-coverage.yaml`,
        `vercel.json` (own cron moved to `50 9 * * *` to avoid a same-minute collision with
        main's new `orchestra-log-purge` cron) -- straightforward additive concatenations.
      - `src/lib/db/schema.ts` -- two conflicts where git's diff had merged two *different*
        tables' closing braces into one shared line (this session's `crmPipelineStages` and
        main's new `crmSalesTargets`); fixed by hand so each table gets its own `})`, verified
        against the raw `HEAD`/`MERGE_HEAD` blobs via `git cat-file -p` (not the truncation-prone
        `git show`, see [[veridian-git-show-large-output-flaky-truncation]]).
      - `src/lib/services/crm-service.ts` -- same "shared closing brace" pattern for
        `getPipelineAiSummary()` (this session) vs `setSalesTarget()` (main); merged import
        block (union of both sides' new symbols: `crmPipelineStages`/`crmLostReasons`/
        `crmSalesTargets`/`crmActivities`/`users`, `TenantDb`, `ne`/`isNull`,
        `buildPipelineDeals`, `ROLE_RANK`/`UserRole`, `serviceErrorBody`); merged
        `updateOpportunity()`'s `patch` type to carry both `currencyId`/`exchangeRate` (this
        session) and `lostReasonId` (main). Verified post-merge: every exported function name
        unique (no duplicate definitions survived), brace depth balances to 0 across the file.
      - `src/lib/services/crm-service.test.ts` -- add/add conflict (both sides added a new test
        file for the same module); combined into one file covering all three pure predicates
        (`isValidStageTransition`, `computeRoundRobinAssignment`, `aggregateLeadSourceEffectiveness`).
      - `src/app/(app)/crm/page.tsx` -- main had independently shipped a Wave 3 refactor
        (2026-07-21) that replaced the old tabbed Leads/Opportunities UI on this page with a
        card-grid "MODULES" overview linking to dedicated per-area pages -- this session's old
        tabs-based "Pipeline" tab no longer fit that architecture. Resolved by adopting main's
        grid entirely and re-homing the Kanban board onto its own new route,
        **`src/app/(app)/crm/pipeline/page.tsx`** (mirrors the header/back-link pattern of
        `crm/accounts/page.tsx`), added as a `MODULES` entry (no count badge -- it's not a
        distinct record count, just opportunities viewed by stage).
      - `src/app/api/crm/opportunities/[id]/route.ts` -- merged import (this session's
        `UserRole` type import + main's new `getOpportunity`/`deleteOpportunity` handlers).
      Verification after resolving: `bun test src/lib/services/crm-service.test.ts` -- **22/22
      pass** (10 from this session + 12 from main, both now in the same file). Every touched
      file round-trips through `bun build --target=node` with zero syntax errors. A full
      `bunx tsc --noEmit` (even with `--max-old-space-size=6144`) still times out at 280s in
      this sandbox -- inconclusive locally, same known pre-existing limitation noted below; CI's
      own Type Check job is the real gate and is running as of this checkpoint (PR #1018,
      commit `1429f1fbc`).
- [x] Watched PR #1018's first real CI run (commit `1429f1fbc`) -- it surfaced 4 genuine
      failures, all fixed live (commit follows this one):
      - **Migration Number Collision Check**: main had independently landed its own
        `drizzle/0225_support_sessions.sql` while this branch was open, colliding with this
        task's `0225_sales_pipeline_module.sql`. Renumbered to `0313_sales_pipeline_module.sql`
        (next free number after main's real highest, 0312, re-verified live via
        `git ls-tree origin/main -- drizzle/`, not guessed) and updated the 2 in-code comment
        cross-references in `crm-service.ts` (lines 595/614) plus this file's own citations.
      - **Type Check**: `src/components/ReportCatalogList.tsx`'s `byDomain` grouping literal
        was missing the new `CRM` key required by `Record<ReportDomain, FullCatalogEntry[]>` --
        the merge-conflict resolution's exhaustiveness fix for this file (noted above) had
        fixed a *different* `Record<ReportDomain,...>` map earlier in Wave-history but this one
        was net-new since. Added `CRM: []`. Re-verified with a full local
        `NODE_OPTIONS="--max-old-space-size=8192" timeout 500 bunx tsc --noEmit` (the earlier
        280s/6144MB attempt had timed out inconclusively; this one completed) -- zero errors in
        any file this task touches; the only remaining errors repo-wide are 10 pre-existing
        `Cannot find module '@fchecklist/veridian-ui-kit/*'` / `@playwright/test` /
        `@mlc-ai/web-llm` findings (private/optional packages not installed in this sandbox,
        unrelated to this diff -- confirmed real CI's own Type Check log showed exactly the one
        `ReportCatalogList.tsx` error and none of these 10, so CI does have those packages).
      - **Unit Tests**: `permission-service.test.ts`'s exhaustive manager-gated-action list
        test didn't yet know about this task's new `crm.pipeline_stages.manage` entry in the
        shared `ERP_ACTION_ROLES` table (a deliberately shared, not ERP-only, action-role table
        per that file's own header comment -- every module is expected to add its actions
        there). Added the new action to the test's expected list, same class as the existing
        `erp.chart_of_accounts.create`/`erp.fixed_assets.category_manage` master-data-config
        entries. The other 3 fail + 2 module-not-found errors in the full `bun test` run
        (`event-bus.test.ts`, `connector-data-service.test.ts`,
        `dispatch-completion-monitor.test.ts`, `HomeThreadSlot.test.ts`, `ChainSelector.test.ts`,
        `departments/route.test.ts`, `v1/tasks/[id]/status/route.test.ts`) are pre-existing and
        untouched by this branch's diff (`git diff --name-only origin/main HEAD` confirms none
        of those files appear) -- not this task's to fix.
      - **Terminology Guardrail Check**: this task's own new dated gap-closure comments (25
        findings across 15 files, all real "when/why this was built" comments, none
        example/sample data) pushed several files' `hardcoded_iso_date` counts above their
        recorded exemption-manifest baseline. Updated 6 existing entries'
        `findings_by_category.hardcoded_iso_date` counts + `reason` text and added 9 new
        entries in `ai-os/registry/terminology-guardrail-exemptions.yaml`, following this
        file's own established "Bumped N -> M (reason)" convention. Re-verified locally:
        `node scripts/check-terminology-guardrail.mjs --diff-only` now passes clean.
      - Not investigated further: **Promptfoo Evals** (unrelated to this task's diff -- no
        prompt-template file this task touches showed up as a cause in the failure summary)
        and **Vercel** (failed with an explicit `build-rate-limit` message, an infra quota
        issue, not a code problem). **audit-check** is expected to fail until the mandatory
        AUDIT comment is posted post-CI-green, per Rule 10.
- [x] Pushed commit `493aa1734` with all 4 CI fixes. New CI run in progress on the fresh
      commit as of this checkpoint (all jobs re-queued/pending, `Vercel` still shows the same
      infra `build-rate-limit` failure independent of code -- not actionable from this side).
- [x] Re-confirmed CI green on commit `67099384f`: all 8 of branch protection's required
      contexts (Lint, Type Check, Build, Guardrail Presence Check, Asset Registry Coverage
      Check, Unit Tests, Metadata Index Coverage Check) pass
      (`gh api repos/FChecklist/compliance-tracker/branches/main/protection --jq
      '.required_status_checks.contexts'` confirms this is the exact required list --
      Promptfoo Evals/Vercel/Terminology Guardrail/Migration Collision/E2E/CodeQL are real but
      non-blocking). Posted the required structured 8-field `AUDIT: PASS` verdict comment
      (Rule 10) at https://github.com/FChecklist/compliance-tracker/pull/1018#issuecomment-5212294619.
- [x] The audit-check job triggered by that comment (`issue_comment`) checks out `main`, not
      this PR's head SHA (a known footgun), so it didn't by itself satisfy the required check
      for merge purposes -- pushed a trivial follow-up commit (`0ad99eceb`) to trigger a real
      `synchronize` event; the job re-ran against the true head SHA and picked up the
      already-posted comment. Confirmed via a live monitor loop: all 8 of branch protection's
      required contexts now show `pass` on commit `0ad99eceb`, including `audit-check`.
- [ ] **BLOCKED on merge, not on this task's own work**: `gh pr view 1018 --json
      mergeStateStatus,reviewDecision` returns `{"mergeStateStatus":"BLOCKED",
      "reviewDecision":"REVIEW_REQUIRED"}` despite every required CI check green. This is the
      known, already-documented standing structural deadlock, not something new or specific to
      this PR: `main`'s branch protection requires 1 approving review + `enforce_admins: true`,
      but every credential in this environment resolves to the same single GitHub identity
      (`FChecklist`), so GitHub structurally refuses self-approval and `gh pr merge --admin`
      fails with a GraphQL "at least 1 approving review required" error regardless of admin
      permission -- confirmed 6-for-6 on every other PR shape tried across 2026-08-06/07
      (docs-only closures AND real feature PRs alike), see prior session memory
      `veridian-branch-protection-self-approval-deadlock-active` /
      `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md`. Per that precedent's own
      guidance: did **not** attempt `gh pr merge` (would just burn a circuit-breaker strike on
      an already-proven failure mode) and did **not** touch
      `required_approving_review_count` myself (that would be guardrail-weakening under
      AGENTS.md Rule 9 without a fresh explicit Owner directive). PR #1018 is fully
      ready-to-merge the moment either a second reviewer identity is provisioned or the Owner
      grants a bounded review-count exception -- this task's own implementation and CI-fix work
      is complete.
- [ ] Once PR #1018 actually merges, move this session's `ACTIVE-CLAIMS.yaml` entry from
      `active:` to `recently_completed:`.

## Re-checked 2026-08-07 (invocation 17/20) -- no change, no action taken
Live re-verification, not a repeat attempt: `gh pr view 1018` still shows
`mergeStateStatus: BLOCKED`, `reviewDecision: REVIEW_REQUIRED`; branch protection still
`required_approving_review_count: 1` + `enforce_admins: true`. `gh pr checks 1018` confirms
all 8 required contexts still green on the same commit (`67099384f`/`0ad99eceb`), plus 6 more
non-required checks passing (only `Vercel`'s infra build-rate-limit and `Promptfoo Evals` fail,
both pre-existing/unrelated, both non-blocking per branch protection's own required-contexts
list). No second reviewer identity has been provisioned; no Owner review-count exception has
been granted. Per this task's own documented precedent (see prior entry + session memory
`veridian-branch-protection-self-approval-deadlock-active`), did **not** re-attempt
`gh pr merge` -- a 6-for-6-confirmed failure mode, retrying would only burn a circuit-breaker
strike for no new information. This task's implementation work remains complete and unchanged;
the merge blocker is structural/environmental, not something further work in this session can
resolve.
