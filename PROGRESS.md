# PROGRESS -- task-20260729-112447-build-extend-workflow-track-engines

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain and `ai-os/boss/ACTIVE-CLAIMS.yaml` protocol before picking work
- [x] Located the real PHASE-2-CROSSREF: `sap_reports` table in `/opt/veridian/ai-os/memory/sap_mapping.sqlite`
      (`engine_track` + `veridian_mapping_status` columns), not a markdown file -- confirmed via direct sqlite
      query and cross-checked against PR #624 / task-20260729-001528's discoverability doc.
- [x] Scoped work: `engine_track='workflow' AND veridian_mapping_status IN ('BUILD_NEW', 'EXTEND_EXISTING(...)')`
      = 2 rows: **SD-002** (Billing Due List) and **SD-007** (Sales Order -- Status Overview). Both BUILD_NEW.
      0 workflow-track EXTEND_EXISTING rows exist. (Treasury-002 is workflow-track but REUSE_EXISTING -- out of
      scope by spec.)
- [x] Found the real `wiring_registry`: live sqlite table in `/opt/veridian/ai-os/memory/superboss-register.sqlite`
      (host-level, shared, NOT this repo), registered via `/opt/veridian/scripts/superboss-register.py
      register-entity` per `ai-os/WIRING_ENGINE_SCHEMA_2026-07-25.yaml` (separate claude-control repo).
- [x] Collision check: 8 sibling branches with the identical task title exist (dispatcher duplication storm,
      2026-07-29 09:29-11:19Z, affecting both workflow-track and calculation-track build tasks). Only 2 have any
      commit beyond main, both claim-registration-only, zero engine code, no open PR. Proceeding given the tiny
      real scope (2 engines) and zero competing implementation -- registered claim in ACTIVE-CLAIMS.yaml
      documenting this.
- [x] Dispatched research agent to survey existing workflow/state-machine patterns in this repo before writing
      any code, per spec's "these are state machines, do not force the wrong shape" instruction. Findings:
      erp-selling-service.ts's `QUOTATION_TRANSITIONS`/`updateQuotationStatus` (explicit `Record<Status,
      readonly Status[]>` transition table) is the established convention -- no shared state-machine helper
      exists in this repo, every status-flow service hand-rolls its own map. `constructionInterimBills` has NO
      status column (generateInterimBill() goes straight from work-progress % to a posted invoice in one call) --
      confirmed a new table is genuinely needed, not an extension of an existing one.
- [x] Built both engines as ONE service, `src/lib/services/construction-billing-workflow-service.ts` (they share
      the same underlying table/state machine -- SD-002 is the queue view, SD-007 is the per-claim trace view):
      - New table `constructionProgressClaims` + `constructionClaimStatusEnum` (schema.ts + hand-written
        migration `drizzle/0269_construction_progress_claims_workflow.sql`, same convention as
        0268_pms_time_entry_approval_flow.sql -- drizzle-kit generate can't diff against an accurate baseline,
        confirmed via that migration's own header)
      - State machine: `milestone_achieved -> drafted -> submitted -> client_approved -> invoiced` (+ `rejected`
        bounce-back to `drafted`), modeled on `QUOTATION_TRANSITIONS`
      - `invoiceApprovedClaim` delegates the real bill computation to the existing `generateInterimBill()` --
        never recomputes it, this service's job stops at the state transition
      - `listBillingDueQueue` = SD-002's "Ready to Bill" worklist (overdue flag when scheduledDate has passed)
      - `getClaimTimeline` = SD-007's "Claim Timeline" document-flow trace (claim -> interim bill -> sales
        invoice -> payment, `isStuck` flag past a documented 14-day threshold)
- [x] Wired 7 API routes under `src/app/api/construction/progress-claims/` (list/create, draft, submit, approve,
      reject, invoice, timeline), mirroring `interim-bills/route.ts` and `kpi-entries/[id]/approve/route.ts`'s
      exact `requireAuth`/`requireRole`/`ServiceError` conventions
- [x] Registered the new engine file in the real wiring_registry immediately after writing it (`register-entity`
      CLI, `entity_id: file-0586774ff0fd`) -- `verification_status: PATH_MISSING` is honest, not a defect: the
      canonical path (`repos/compliance-tracker/...`) won't exist until this branch merges
- [x] 14 unit tests (`construction-billing-workflow-service.test.ts`, same mock-`withTenantContext` pattern as
      `pms-time-service.test.ts`) -- all pass, plus the 2 neighboring service test files (38 total, 0 fail)
- [x] `tsc --noEmit` clean on all new/changed files, `eslint` clean, `check-terminology-guardrail.mjs`/
      `check-guardrail-presence.mjs`/`check-metadata-index-coverage.mjs`/`check-migration-collision.mjs` all pass

- [x] Opened PR #629: https://github.com/FChecklist/compliance-tracker/pull/629

## Remaining
- [ ] CI + merge (per AGENTS.md Rule 6, no self-merge without CI green)
- [ ] Move this task's ACTIVE-CLAIMS.yaml entry to recently_completed once merged

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
