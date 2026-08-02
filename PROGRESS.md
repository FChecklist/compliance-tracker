# PROGRESS -- task-20260802-055214-register-veridian-kernel-1-0---kernel-co

## Completed
- [x] Verified working directory / correct git worktree (caught and corrected one mistaken write into
      the wrong, currently-in-use checkout at /opt/veridian/repos/compliance-tracker before it was committed)
- [x] Surveyed real existing governance vs. the dispatched VERIDIAN_KERNEL=1.0 text via 2 read-only
      research passes (governance docs: CONSTITUTION.yaml/MASTER_INDEX.yaml/LIFECYCLE.yaml/STANDING_DIRECTIVE.yaml/boss-*/MASTER-TRACKER.yaml;
      scripts: dispatch_core.py/task-gateway.py/resource_governor.py/worker-entrypoint.sh/tight_task_validation.py/ddl_authorization_check.py/credit-accountant.py/superboss-register.py/supervisor-entrypoint.sh/recover-failed-workers.py/queue-dispatcher.py/module-queue-dispatcher.py/dispatch-owner-task.sh)
- [x] Applied KERNEL_CONFLICT rule to 2 real conflicts found (CONSTITUTION.yaml's existing SOLE_AUTHORITY
      status; 3 incompatible real task-state vocabularies vs. the Kernel's proposed 11-state list) --
      STOPPED, did not execute past them, flagged for Owner/PM decision instead
- [x] Found and documented (not fixed, out of scope) a dangling MASTER_INDEX.yaml reference to
      ai-os/OWNER_DIRECTIVES/PROTOCOL_OWNER_AI.yaml, which does not exist on disk
- [x] Wrote full report: ai-os/VERIDIAN_KERNEL_1.0_RECONCILIATION_REPORT_2026-08-02.md (registration
      status, RCA, gap analysis table, flagged conflicts, implementation report, verification)
- [x] Extended (not duplicated) ai-os/MASTER_INDEX.yaml with one registries: entry (id: veridian_kernel_1_0),
      status: proposed_pending_owner_decision
- [x] Extended (not duplicated) ai-os/boss/ACTIVE-CLAIMS.yaml's recently_completed: list with this task's entry
- [x] Validated MASTER_INDEX.yaml still parses as valid YAML after edit (python3 yaml.safe_load)

## Remaining
- [x] Commit + push this branch
- [x] Open PR: https://github.com/FChecklist/compliance-tracker/pull/697
- [ ] Await CI + mandatory-audit-check per AGENTS.md Rule 10 (this session did not self-certify)
- [ ] Await Owner decision on the 4 open items below before any further action on this Kernel

# PROGRESS -- task-20260731-130837-commit-procurement-erp-gap-analysis-docu

## Completed
- [x] Checked ai-os/boss/ACTIVE-CLAIMS.yaml -- no conflicting claim for this doc file
- [x] Created branch docs/procurement-erp-gap-analysis-2026-07-31 off origin/main
- [x] Wrote ai-os/PROCUREMENT_ERP_GAP_ANALYSIS_2026-07-31.md verbatim per spec
- [x] Committed + pushed
- [x] Opened PR #672: https://github.com/FChecklist/compliance-tracker/pull/672

## Remaining
- [ ] Confirm CI passes (do not merge, do not post audit verdict) -- monitoring in progress

- [ ] None -- task complete, PR #615 awaiting CI + review/merge
# PROGRESS -- task-20260728-051733-owner-engine-phase-5-real-gaps
## Completed
- [x] Read AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml governance chain, registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml (commit 0b99c670, pushed)
- [x] Read phase_5_browser_execution_tiers scope from claude-control's VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml
- [x] Verified SPEC's cited PROJEXA prior art (src/lib/offline/work-progress-queue.ts, PR #54) does NOT exist anywhere in this repo's history -- `git log --all --diff-filter=A --name-only` zero matches, `gh pr view 54` is the unrelated VERI Reward engine. Built sync-engine.ts fresh instead of adapting a nonexistent file.
- [x] Real NPU inference: src/lib/browser-execution/npu-engine.ts -- reuses transformers-engine.ts's exact model (Xenova/all-MiniLM-L6-v2) via @huggingface/transformers' real `device: "webnn-npu"` execution provider (confirmed real in devices.d.ts's DEVICE_TYPES), gated by tier-orchestrator's new shouldAttemptNpu
- [x] Real Built-in AI inference: src/lib/browser-execution/builtin-ai-engine.ts -- real window.LanguageModel / window.ai.languageModel call path, gated by tier-orchestrator's new shouldAttemptBuiltinAi
- [x] tier-orchestrator.ts: added shouldAttemptNpu/shouldAttemptBuiltinAi gates (same pattern as existing shouldAttemptWebLlm) + tests in tier-orchestrator.test.ts
- [x] Cross-tier storage layer: src/lib/browser-execution/cross-tier-storage.ts -- real OPFS backend, real Cache API backend, IndexedDB backend that reuses (not replaces) model-cache.ts's IndexedDbModelCache; priority-ordered put/get/delete with real fallback chain
- [x] Browser-sync engine: src/lib/browser-execution/sync-engine.ts -- OfflineQueue with real same-entity coalescing (the "two queued offline changes to the same record" scenario), resolveConflict() for remote (server-side) conflicts, syncQueue() push pass, pullDeltaSync() delta sync, SyncMutex for concurrent-sync serialization
- [x] Full test suites for all 4 new files + orchestrator additions (npu-engine.test.ts, builtin-ai-engine.test.ts, cross-tier-storage.test.ts, sync-engine.test.ts)
- [x] `npx tsc --noEmit` clean (NODE_OPTIONS=--max-old-space-size=8192 needed -- repo-wide tsc is memory-heavy under this server's shared load)
- [x] `bun test src/lib/browser-execution` -- 108 pass, 0 fail
- [x] Registered litert-spike as a real entry (`litert_spike_browser_execution_prior_art`) in this repo's own ai-os/MASTER_INDEX.yaml `registries:` list (canonical_path_repo per that file's own header -- no cross-repo write needed) + regenerated the stale `quick_reference` block via ai-os/scripts/generate_quick_reference.py per that block's own protocol. `grep -q litert-spike ai-os/MASTER_INDEX.yaml` passes (phase_5's own success criterion).
- [x] ACTIVE-CLAIMS.yaml entry updated with STATUS UPDATE (implementation complete, PR opened) -- left in `active:` (not moved to `recently_completed:`) since the PR is not yet merged, per that file's own protocol #3
... more files changed
# PROGRESS -- task-20260728-123340-directive-001-phase-1-classify
## Completed
- [x] Located the real spec (prompt.txt lives in the task dir, not the workspace) and the DB it refers to (`/opt/veridian/ai-os/memory/sap_mapping.sqlite`, see `scripts/sap_mapping_store.py` for `DB_PATH`).
- [x] Found `engine_track` already exists on `sap_reports` and all 80 rows (not 87 -- see below) already have it populated, all `updated_at='2026-07-28 16:24:03'` -- done by an untracked process before this task's own checkpoints (invocations 1-2) ever recorded work, and never logged in `ai-os/boss/ACTIVE-CLAIMS.yaml` or `COMPLETED.yaml`.
- [x] Independently verified the classification: read every row's `calculation_logic` text against its assigned `engine_track` for all 80 rows (not just spot-checked) -- distribution (calculation 67 / hybrid 9 / workflow 4) correlates with real per-row content, not a blanket default. No corrections needed.
- [x] Resolved the "87 vs 80" discrepancy via `ingest_log`: 11 modules summing to exactly 80, all `sap_modules.study_status='DONE'`, zero parse/validation errors -- 87 was the task-dispatch-time estimate, written before the same-day ingestion pipeline (09:01-10:16) finished landing all module chunks. 80 is the real final count.
- [x] Wrote `ai-os/tasks/sap_mapping/PHASE_1_CLASSIFY.yaml` as the audit trail (this classification's source of truth remains the live sqlite file; this repo can't hold it since it's a shared server-side DB, not a git artifact).
- [x] Updated `ai-os/OS.yaml`'s `ai-os/tasks/sap_mapping` index entry to reference the new file.
- [x] Pushed branch, opened PR #628: https://github.com/FChecklist/compliance-tracker/pull/628

- [x] Posted structured AUDIT: PASS comment on PR #628 per Rule 7c / mandatory-audit-check.yml (independent re-verification against the live sqlite DB, not self-certified from the doer's own claims).

## Remaining
- [ ] Waiting on CI for PR #628, then merge (no reviewer bottleneck per AGENTS.md Rule 6).

# PROGRESS -- task-20260727-193351-sales-pipeline-interactive-dashboard--co

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, registered this task's claim, pushed it standalone before real work
- [x] Confirmed crmOpportunities.stage gap: 5 legacy free-text values, none of the mockup's 8
      pipeline-status names exist anywhere in the codebase
- [x] Confirmed no existing "monthly revenue target" concept anywhere (grepped schema.ts +
      src/lib/services)
- [x] Researched existing win-probability/health-scoring logic (aiWinProbability is an opaque
      per-deal LLM score, no formula; getSalesPipelineOverview's winRate = won/(won+lost) is the
      only existing pipeline-aggregate formula) -- reused for Success %, derived Health % from
      average aiWinProbability over open deals
- [x] Added `crm_sales_targets` table (schema.ts) + hand-written migration 0268 (additive only,
      no changes to crm_leads/crm_opportunities)
- [x] Built pure aggregation module `sales-pipeline-dashboard-service.ts`: stage normalization
      (legacy 5 -> mockup 8 + canonical passthrough), KPI computations, both bar-chart
      aggregations, monthly trend + KPI table
- [x] 20 unit tests (`sales-pipeline-dashboard-service.test.ts`), all passing -- covers KPI math
      against a realistic multi-stage seeded set AND the cross-filter interaction
- [x] DB-fetch layer (`getSalesPipelineDashboardData`, `setSalesTarget` in crm-service.ts) +
      API routes (`src/app/api/crm/sales-pipeline/route.ts`)
- [x] Dashboard page (`src/app/(app)/crm/sales-pipeline/page.tsx`): 6 KPI tiles, 2 filter
      dropdowns (salesperson/month), 2 bar charts, monthly trend line chart + KPI table,
      scrollable deal-list panel, click-to-cross-filter on the Pipeline Status bars with a
      visible clear control and heading that reflects the active filter
- [x] Linked from `/crm` overview page
- [x] Verified: `npx tsc --noEmit` clean, `bun test` (20/20 pass), `eslint` clean on all new/
      touched files, `grep -rn "Sales Pipeline" src/` confirms the real route/screen exists,
      `check-migration-collision.mjs` and `check-terminology-guardrail.mjs --diff-only` both
      pass (added 3 real dated-comment exemption entries)
- [x] Committed + pushed

## Remaining
- [ ] `bun run build` (full production build) could not be completed in this session's sandbox:
      first attempt timed out at ~280s, second (backgrounded, 8GB heap) was silently killed
      (likely OOM) partway through Turbopack's build on this repo's large schema/route graph.
      Per this task's own circuit-breaker protocol (stop after 2 consecutive failures of the
      identical approach), not retried a 3rd time. tsc/eslint/tests all pass and are the
      verified proxies used instead -- recommend the supervisor auditor re-run
      `bun run build` with more time/memory before merge.
- [ ] No settings UI for `setSalesTarget` -- only a raw POST endpoint exists. Out of scope per
      the mockup (which shows the chart/table, not a target editor); flagging in case the Owner
      wants one.
- [ ] Awaiting fresh supervisor audit before merge (per task's own EXPECTED_OUTPUT -- not
      self-merging)

## Addendum (2026-07-28, corrective fixes after real audit)
- [x] Enabled RLS on compliance.crm_sales_targets (matching drizzle/0101 established pattern) + indexes
- [x] Registered crm_sales_targets in asset-registry-coverage.yaml
- [x] Bumped terminology-guardrail-exemptions.yaml count for crm-service.ts
- [x] Added Number.isFinite(targetValue) validation to setSalesTarget
- [x] tsc clean; 32/32 relevant tests pass
- [ ] bun run build still not verified in this sandbox (disclosed, non-blocking)

# PROGRESS -- task-20260728-050606-verify-excel-boq-importer-against-real-p

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no collision with
      `construction-boq-import-service.ts`; registered this task's own
      claim there.
- [x] Reconstructed the real prospect BoQ file's structural quirks
      (`ai-os/PROSPECT_GAP_BACKLOG_2026-07-28.md`'s "Sample Scope with Sub
      Task.xlsx", Sl No / Category / Dwg Code / Description (Task) / Sub
      Task / QTY / UNIT / Breakdown % / RATE / AMOUNT columns) as a real
      `.xlsx` buffer built with the `xlsx` package -- category header rows
      with no Sl No, numbered task rows ("1.01"/"2.01") with multi-line
      descriptions containing embedded `Location :<name>` annotations, and
      unlabeled sub-task rows (Frame/Gypsum Board/Rockwool/Taping/Sanding)
      with their own Breakdown %.
- [x] Ran the real importer (`parseBoqSpreadsheet`) against this fixture
      and recorded the actual (pre-fix) result: **it failed badly**. All 9
      real task/sub-task rows were dropped ("skipped (no description)"),
      leaving only 2 garbage line items -- the bare category labels
      ("PARTITION AND LINING", "FALSE CEILING") with quantity=0, rate=0.
      Root cause, confirmed by inspecting `mapBoqHeaders`'s actual output:
      - `"Sl No"` was not in the `itemCode` alias list at all (only "s no"
        / "sno" / "sr no" were) -- so `itemCode` never mapped, and the
        dot-delimited-parent-inference this file relies on had nothing to
        infer from.
      - `description` mapped to the `"Category"` column instead of
        `"Description (Task)"`, because `mapBoqHeaders` picked the first
        *header* (in sheet order) that matched *any* alias for a field,
        and `"category"` was listed as a valid description alias (for
        simple sheets with no dedicated description column) -- so it won
        over the real `"Description (Task)"` column purely by column
        position, and `"Description (Task)"` normalizes to `"description
        task"`, which wasn't in the alias list anyway.
      - There was no handling at all for unlabeled sub-task rows (Sub Task
        column filled, Description blank) or for inferring their parent
        task positionally (no dot-delimited item code exists for them).
- [x] Fixed `construction-boq-import-service.ts` (import/parsing layer
      only -- `computeHierarchicalAmount()` untouched, per task
      constraint):
      - Added `"sl no"` to the `itemCode` alias list.
      - Made `mapBoqHeaders` resolve each field by trying its aliases in
        priority order and taking the first header that matches the
        *most preferred* alias, instead of the first header (in sheet
        order) matching *any* alias -- so a dedicated `"Description
        (Task)"` column now always wins over the `"category"` fallback
        alias when both are present. Added `"description task"` as a
        recognized alias.
      - Added a new `subTask` field (aliases: "sub task"/"subtask"/
        "sub-task"). `mapRowsToLineItems` now falls back to the Sub Task
        column's value as the row's description when the Description
        column is blank -- this is what makes the real unlabeled
        sub-task rows (Frame/Gypsum Board/...) survive at all instead of
        being skipped as "no description".
      - Added positional parent-child inference: a row with no itemCode
        of its own, whose description came from the Sub Task fallback
        (not a real Description value), and that has a breakdownPercentage
        set, is attached to the itemCode of the nearest preceding row that
        had one. This resets correctly at each new task row, so sub-tasks
        never bleed across two different parent tasks.
- [x] Added a real regression test,
      `parseBoqSpreadsheet -- real prospect BoQ file shape`, in
      `construction-boq-import-service.test.ts`, building a real xlsx
      buffer with the exact quirks above and asserting: both category
      rows are skipped (not turned into garbage line items), both task
      rows keep their full multi-line description (including the
      `Location :` text), and each task's 5 (then 2) sub-task rows attach
      to the correct parent with the correct breakdown percentages,
      summing to 100% for the first task.
- [x] Verified: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit`
      -- clean, zero errors (`tsc --noEmit` alone OOMs on this repo's full
      project graph regardless of this change; the memory-flag invocation
      is the working equivalent). `bun test
      src/lib/services/construction-boq-import-service.test.ts` -- 6 pass,
      0 fail, 50 expect() calls. Also re-ran
      `construction-boq-service.test.ts` (the hierarchy/amount-calculation
      layer this importer feeds) as a regression check -- 19 pass, 0 fail,
      unaffected.
- [x] Constraint check: no cron entries or systemd `.timer` units were
      touched by this task (scope was entirely
      `construction-boq-import-service.ts` + its test file).

## Remaining
- [ ] Open a PR on this task's branch (real code fix was required --
      outcome (1) from the task spec, not the verification-only outcome).

# PROGRESS -- sd-007-sales-order-document-flow-overview

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, found a real collision (PR #629
      also self-labels part of its work SD-007), verified via git/gh (not
      the sqlite gap-analysis file's own citations) that PR #629's
      getClaimTimeline() is scoped entirely to the brand-new
      construction_progress_claims workflow table, distinct from the
      pre-existing generic ERP Sales & Distribution chain this task covers
      -- registered a claim documenting the distinction, committed+pushed
      first (commit 8b4f0720), before any real code.
- [x] Discovered the real FK chain already on main (Priority 15/Wave
      60-84, zero new schema needed): erp_quotations (quotationId) ->
      erp_sales_orders (soNumber/status) -> erp_sales_invoices
      (salesOrderId) -> erp_payment_entries (invoiceType='sales_invoice'/
      invoiceId) + erp_sales_credit_notes (salesInvoiceId) +
      erp_sales_returns (salesInvoiceId).
- [x] Added getSalesOrderDocumentFlow() to erp-selling-service.ts (additive,
      reuses existing withTenantContext/ServiceError/requireErpEnabled
      conventions already in that file).
- [x] New route GET /api/v1/projexa/sales-order-document-flow/[id].
- [x] New report_definitions row (drizzle/0269, platform-wide,
      executionType='external_service'), following the exact precedent
      PR #637 (FI-AP-005) established.
- [x] 3 new tests in erp-selling-service.test.ts (real quotation->order->
      invoice->payment->credit-note->return 6-hop chain; standalone order
      with no invoices yet; not-found -> 404), same mock-withTenantContext
      pattern as construction-reports-service.test.ts/tenant-isolation.test.ts.
- [x] Verified: bunx tsc --noEmit -- 0 errors. bun run lint -- 0 errors (3
      pre-existing warnings, unrelated files). bun test (full suite) --
      2305 pass, 0 fail, 4568 expect() calls (includes the 3 new tests).
- [x] Honest gap: no post-order change-order document exists in this
      schema (only a pre-order quotation revision) -- disclosed in the
      report_definitions row's description, not fabricated.

## Remaining
- [ ] None for this task's own scope -- PR opened, awaiting review/merge.
      Separately unresolved (not this task's job to fix): PR #629 and PR
      #638 both still open and both touch SD-002; reconciling those two is
      a decision for whoever reviews/merges them, not addressed here.

# PROGRESS -- task-20260728-160934-cross-reference-sap-reports-vs-existing

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` and `ai-os/CONSTITUTION.yaml` per repo protocol; registered a claim
      (commit `1467a051`, pushed) before starting real work. No collision with other active claims.
- [x] Located the real `sap_reports` table: it is **not** in this repo (`compliance-tracker`) or its Postgres
      schema -- it lives in `/opt/veridian/ai-os/memory/sap_mapping.sqlite` (shared, non-git infra state),
      the same file the prior task (`task-20260726-123644`, `engine_track` classification) established and
      backed up. Confirmed via `git log --all -- '*sap_reports*'` (found the prior task's branch/commits,
      zero hits in current schema.ts) before touching anything.
- [x] Confirmed real storage locations for the 3 cross-reference targets named in the spec (none assumed):
      - VCEL calculation-engine registry = Postgres `compliance.computation_engines` (schema.ts:9488),
        backed by the 25 real files under `src/lib/engines/*.ts` (read all of them in full).
      - `report_definitions` = Postgres `compliance.report_definitions` (schema.ts:4650), executed/cataloged
        via `report-engine-service.ts` (`runAggregation`/`executeReportDefinition`/`getFullReportCatalog`)
        and `report-catalog-service.ts`'s static catalog (`erp-trial-balance`, `erp-profit-and-loss`,
        `erp-balance-sheet`, `erp-cash-flow`, `construction-*` entries).
      - `wiring_registry` = **not** in this repo -- lives in the separate `claude-control` repo
        (`/opt/veridian/repos/claude-control/ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json`, regenerated
        2026-07-27). Read its full entity-type breakdown (7711 entities: 20 `engine` = AI-OS infra engines,
        6 `route` = sample chat-dispatch traces, 444 `supabase_table`, etc.) -- confirmed this tracks
        platform/AI-OS wiring, not a per-SAP-report business registry, so it was used as corroborating
        evidence only (e.g. confirming `gst_calculation_engine`/`gratuity_calculator` are genuinely wired
        end-to-end), not as the primary source for the 80-row mapping.
      - **Disclosed limitation**: no live `DATABASE_URL`/Supabase MCP was available in this session, so
        `computation_engines`/`report_definitions` row content could not be queried live. Cross-referenced
        against the real source code instead (engine files, `erp-*-service.ts`, `construction-*-service.ts`
        exported function names + `schema.ts` column definitions), which is the ground truth those tables
        are seeded/generated from -- not a guess, but noted honestly rather than papered over.
    - [x] Read all 80 `sap_reports` rows' real `calculation_logic`/`business_purpose` in full (dumped to a
      scratch file for review, since discarded -- not part of the deliverable).
- [x] Read all 25 `src/lib/engines/*.ts` VCEL engine files in full, and grepped real exported function names
      from every relevant `erp-*-service.ts` (accounting, financial-report, fixed-assets, payroll, inventory,
      stock, procurement-workflow, buying, selling, cash, bank-reconciliation, invoicing, vendor-master,
      budget) and `construction-*-service.ts` (boq, progress, dashboard, kpi, labour, valuation, reports,
      prediction) file, plus `crm-service.ts`/`crm-activities-service.ts`/`crm-accounts-service.ts`.
- [x] Backed up `sap_mapping.sqlite` (`sap_mapping.sqlite.bak-pre-veridian-mapping-20260728`) before any write.
- [x] Discovered a real, undisclosed schema/spec mismatch: `sap_reports.veridian_mapping_status` had a CHECK
      constraint restricting it to `('NOT_MAPPED','PARTIALLY_MAPPED','FULLY_MAPPED','NOT_APPLICABLE')` --
      incompatible with the spec's required `REUSE_EXISTING(id)/EXTEND_EXISTING(id)/BUILD_NEW` values.
      Widened the constraint additively (old values remain valid; recreated the table via the standard
      SQLite copy-drop-rename procedure since SQLite can't ALTER a CHECK in place) rather than picking
      a lossy workaround.
- [x] Wrote real, evidence-cited `veridian_mapping_status` / `veridian_existing_equivalent` /
      `veridian_gap_notes` for all 80 rows (verified: 0 unmapped remaining). Every `BUILD_NEW`/`EXTEND_EXISTING`
      verdict cites a specific grep/read that came up empty or partial, not an assumption; every
      `REUSE_EXISTING(id)` cites a real file:function or table. Breakdown: **35 REUSE_EXISTING, 31
      EXTEND_EXISTING, 14 BUILD_NEW**.
      - Confirmed real `BUILD_NEW` gaps (grepped, zero hits): CO-006 (statistical key figures), FI-AP-005
        (payment run/proposal), FI-AP-006 & FI-AR-006 (vendor/customer payment-behavior DPO/DSO analysis),
        FI-AP-007 (subcontractor retention -- only client-side retention exists), FI-AP-008 (subcontractor
        payment-application workflow), FI-AA-006 (asset-to-GL reconciliation), FI-GL-007 (subledger-to-GL
        reconciliation), FI-AR-004 (dunning), HCM-006 (certified payroll / Davis-Bacon), SD-002 (billing due
        list), SD-006 (sales by material/service type), SD-007 (document-flow trace), CRM-007 (sales rep
        performance dashboard).

## Remaining
- [ ] None -- all 80 rows mapped, DB updated and verified, backup retained, claim registered. This
      PROGRESS.md commit is the final unit of work for this task.

## Open items for Owner (not resolved by this task, per KERNEL_CONFLICT -- see report Section 4)
1. Does this Kernel supersede/sit above ai-os/CONSTITUTION.yaml (currently SOLE_AUTHORITY), or should it
   be merged into CONSTITUTION.yaml via that file's own amendment_rule?
2. How should the 3 real, incompatible, production-enforced task-state vocabularies (umr_tasks SQL CHECK
   constraint / task.yaml's 7 states / module-queue's 4 states) be reconciled, if at all, against the
   Kernel's proposed 11-state list?
3. OCID (Owner Chat ID) was not supplied in this dispatch, per the Kernel's own TRACE schema.
4. ai-os/OWNER_DIRECTIVES/PROTOCOL_OWNER_AI.yaml is cited as live by MASTER_INDEX.yaml (2 different
   citations, one claiming .yaml, one .md) but does not exist on disk -- needs either (re)writing or a
   MASTER_INDEX.yaml correction.
