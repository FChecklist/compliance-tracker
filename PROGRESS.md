# PROGRESS -- task-20260729-001528-cross-reference-sap-reports-vs-existing

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` / `AGENTS.md` / `CLAUDE.md` per repo protocol before starting.
- [x] Located the real `sap_reports` data: **not** in this repo, not a Postgres table -- it lives in
      `/opt/veridian/ai-os/memory/sap_mapping.sqlite` (shared, non-git host infra state). Confirmed via
      `git log --all`, `find`, and direct grep of `src/lib/db/schema.ts` (zero hits).
- [x] Discovered this exact SPEC was **already fully completed the day before**, by a different session
      (`task-20260728-160934-cross-reference-sap-reports-vs-existing` -- same title, same task). It wrote
      real, evidence-cited `veridian_mapping_status`/`veridian_existing_equivalent`/`veridian_gap_notes`
      for all 80 `sap_reports` rows directly into the live sqlite file (commits `1467a051`/`ee757052`/
      `556595ec` on `origin/worker/task-20260728-160934-cross-reference-sap-reports-vs-existing`), but
      never opened a PR for those commits, so `ai-os/boss/ACTIVE-CLAIMS.yaml` on `main` never recorded
      it -- almost certainly why this duplicate task got spawned.
- [x] Confirmed real storage locations for all 3 cross-reference targets named in the SPEC (matches the
      prior session's own findings, re-verified independently):
      - VCEL calculation-engine registry = Postgres `compliance.computation_engines`
        (`src/lib/db/schema.ts:9488`), backed by 25 files under `src/lib/engines/*.ts`.
      - `report_definitions` = Postgres `compliance.report_definitions` (`src/lib/db/schema.ts:4650`),
        seeded via `drizzle/0180-0183_*.sql`, executed via `report-engine-service.ts`'s
        `FORMULA_REGISTRY`/`TABLE_REGISTRY`/AI-recipe executor.
      - `wiring_registry` = **not** in this repo -- the separate `claude-control` repo's
        `ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json` (confirmed present there, absent here).
- [x] Independently verified the prior session's work rather than trusting or blindly redoing it:
      opened `sap_mapping.sqlite` **read-only** (`mode=ro`) via Python's stdlib `sqlite3` and queried
      directly. Confirmed: 80 rows total, 0 unmapped, live split **37 REUSE_EXISTING / 29
      EXTEND_EXISTING / 14 BUILD_NEW** (flagging: the prior session's own PROGRESS.md self-reported
      35/31/14 -- off by 2 in the REUSE/EXTEND split; the live table is authoritative, individual
      verdicts were checked directly so this discrepancy doesn't affect correctness). Spot-checked 6 of
      the 80 rows' `veridian_existing_equivalent` citations against real source:
      `erp-invoicing-service.ts:653` genuinely exports `arAgingReport`, `erp-buying-service.ts:201`
      genuinely exports `getSupplierScorecard`, `project-management-engine.ts:69` genuinely exports
      `calculateEarnedValueMetrics`, and the two re-checked `BUILD_NEW` verdicts (`FI-AP-005` Payment
      Run, `FI-AR-004` Dunning) still return zero grep hits for their claimed-absent concepts. All
      confirmed real and accurately cited -- no fabrication found.
      Also confirmed the CHECK-constraint widening the prior session made (to accept
      `REUSE_EXISTING(...)/EXTEND_EXISTING(...)/BUILD_NEW` alongside the old
      `NOT_MAPPED/PARTIALLY_MAPPED/FULLY_MAPPED/NOT_APPLICABLE` vocabulary) is live in the current
      schema and did not touch the file myself (no write needed).
- [x] Landed the actually-missing piece: added a `recently_completed` entry to
      `ai-os/boss/ACTIVE-CLAIMS.yaml` crediting the original session's work and this session's
      verification, so the registry finally reflects reality on `main`.
- [x] Added `ai-os/tasks/sap_mapping/SAP_REPORTS_80_CROSS_REFERENCE_STATUS.yaml` -- a discoverability
      pointer documenting the real `sap_reports` location, the full lineage
      (`task-20260728-123644` engine_track classification -> `task-20260728-160934` cross-reference ->
      this task's verification), and the verified results, so a third session finds this instead of
      grepping the repo, finding nothing, and redoing the same 80-row cross-reference again. Updated
      `ai-os/OS.yaml`'s existing `ai-os/tasks/sap_mapping` index entry to mention the new file.
- [x] Flagged (not fixed, separate task's scope): PR #624
      (`worker/task-20260728-123644-classify-87-sap-reports-into-engine-trac`, the engine_track
      classification that fed this cross-reference) is OPEN and MERGEABLE on GitHub but BEHIND `main`
      -- needs an update-branch + CI + merge by a future session or the Owner.

## Remaining
- [ ] None from this task's own scope. Two items intentionally left for others (documented above,
      not silently dropped): (1) PR #624 needs updating against `main` and merging; (2) a future
      SAP-mapping phase, if the Owner wants one, should start from
      `SAP_REPORTS_80_CROSS_REFERENCE_STATUS.yaml` + a fresh live query of `sap_mapping.sqlite`, not
      from scratch.

## Update (2026-07-31, stale-PR triage session): item (1) above resolved
PR #624 was closed (not merged) as superseded by PR #628, which carries the same
`engine_track` classification claim with a more complete audit trail
(`ai-os/tasks/sap_mapping/PHASE_1_CLASSIFY.yaml`) and its own independent
`AUDIT: PASS` comment. PR #628 was rebased onto current main in the same
triage session. No action needed here beyond this note.

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

- [x] PR opened: https://github.com/FChecklist/compliance-tracker/pull/616 -- all real CI checks pass (Lint, Type Check, Build, Unit Tests, E2E Tests, Analyze, Guardrail Presence, Secret Scanning, Security Pattern, Terminology Guardrail, Doc Cross-Reference/Quarantine/Sentinel, Metadata Index Coverage, Asset Registry Coverage). `audit-check` correctly still fails (awaiting the mandatory human/auditor "AUDIT: PASS/FAIL" comment -- exactly the fresh supervisor audit this task's own EXPECTED_OUTPUT requires, not bypassed). `Vercel` failed on an unrelated deployment rate-limit, not a code issue.

## Remaining
- [ ] PR #616 needs a fresh supervisor audit before merge (this task does not self-merge per EXPECTED_OUTPUT)
- [ ] Once merged: move ai-os/boss/ACTIVE-CLAIMS.yaml entry from `active:` to `recently_completed:`

# PROGRESS -- task-20260728-043316-design-studio-timesheets--designer-wise

## Completed
- [x] Read governance docs, registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Audited existing infra: confirmed designer-wise Budget-vs-Actual cut (byDesigner) already exists in construction-reports-service.ts (PR #597 + audit fix 46d6967d) -- SCOPE item 1 already satisfied, no rebuild needed
- [x] Audited existing infra: confirmed a full KPI designer-fills/manager-approves table pair already exists (constructionKpiDefinitions/constructionKpiEntries, construction-kpi-service.ts, /api/construction/kpi-entries + /[id]/approve) -- SCOPE item 3 already satisfied, not duplicating

- [x] Schema: added `pmsTimeEntryApprovalStatusEnum` (draft/submitted/approved/rejected) + approvalStatus/approvedById/approvedAt/rejectionReason columns to `pmsTimeEntries` (schema.ts)
- [x] Hand-written migration `drizzle/0268_pms_time_entry_approval_flow.sql` + `_journal.json` entry (same drizzle/meta snapshot-gap approach documented in 0267's header)
- [x] Service: `submitTimeEntry`/`approveTimeEntry`/`rejectTimeEntry` in pms-time-service.ts, modeled on construction-kpi-service.ts's submitKpiEntry/approveKpiEntry (self-approval blocked, state-machine enforced)
- [x] API routes: `/api/pms/time-entries/[id]/{submit,approve,reject}` -- approve/reject gated via `requireRole(dbUser, "manager")`
- [x] Report: `designerApprovalStatusReport`/`aggregateDesignerApprovalStatus` (designer-wise approval-status view) in construction-reports-service.ts
- [x] Report: `workAnalysisReport`/`aggregateWorkAnalysis` (hours by task/category per designer over a period) in construction-reports-service.ts
- [x] Registered both new reports (`designer-approval-status`, `work-analysis`) in REPORT_REGISTRY + dispatcher route (dateFrom/dateTo query params for work-analysis)
- [x] Tests: existing designer-wise Budget-vs-Actual cut tests (PR #597) still pass unmodified; new pure-aggregator tests for both new reports; new state-machine tests (self-approval blocked, wrong-state transitions blocked, happy path) in pms-time-service.test.ts; new route-level access-control test (member 403'd, manager allowed) in approve/route.test.ts
- [x] Verified: `bunx tsc --noEmit` clean; `bun test construction-reports-service.test.ts` (10 pass, includes all pre-existing PR #597 tests); full `bun test` -- 2244 pass, 0 fail
- [x] Commit + push

## Remaining
- [ ] Open PR, request supervisor audit (per EXPECTED_OUTPUT -- not self-merged)

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
