# PROGRESS -- task-20260718-082004-crm---sales-modules--sales-pipeline

VERIDIAN Review Framework gap-closure: CRM & Sales Modules / Sales Pipeline (14 findings).

## Already resolved before this task (verified live, findings were stale)
- `getSalesPipelineOverview()` (crm-service.ts) and the `/api/v1/projexa/sales-pipeline`
  external-API alias were already fully implemented (leadsByStatus, opportunitiesByStage,
  winRate, openPipelineValue, overdue follow-up counts). Not rebuilt.

## Completed
- [x] **Data Model Completeness & Referential Integrity** -- new org-scoped `crm_pipeline_stages`
      config table (drizzle/0225), lazily auto-seeded per org with the 5 pre-existing hardcoded
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
      (drizzle/0225). Ephemeral (not persisted) -- no single entity row to cache it against.
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
      (drizzle/0225, identical shape to drizzle/0208's fix for `erp_quotations`/
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
- Not run in this sandbox (no live `DATABASE_URL`): the drizzle/0225 migration itself, and any
  route requiring a live DB. Migration SQL follows this repo's own established, previously-
  applied pattern (drizzle/0219 crm_accounts, drizzle/0208 currency columns) closely enough to
  be low-risk, but has not been executed against a real database by this session.

## Files touched
- `drizzle/0225_sales_pipeline_module.sql` (new migration)
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
- [ ] Open a PR against `main` (branch protection + CI gate per AGENTS.md Rule 6) -- not yet
      opened as of this checkpoint; next invocation should run `gh pr create` and let CI
      (Lint/Type Check/Build/Unit Tests) run, then address any real failures it surfaces.
- [ ] Move this session's `ACTIVE-CLAIMS.yaml` entry from `active:` to `recently_completed:`
      once the PR merges.
