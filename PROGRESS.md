# PROGRESS -- task-20260728-050704-sap-informed-veridian-phase-0--baseline

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no collision, registered claim, pushed (commit 887fae43)
- [x] Located real data sources: ai-os/DATABASE_CATALOG.json (compliance-tracker, 449-table snapshot from 2026-07-26) + claude-control repo's ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json (7711 entities; only 6 generic "route" entities, 444 supabase_table, 1371 src/app/api functions -- not useful for per-route domain categorization, used DATABASE_CATALOG.json + direct grep as primary per spec's own fallback guidance)
- [x] Diffed DATABASE_CATALOG.json's 449 tables against current schema.ts's real 464 `.table(` declarations -- found 15 new tables added since the snapshot (hr loans/expense-claims/shift-roster, performance-review goals/raters, helpdesk SLA/escalation/ticket-teams, construction interim bills), pulled their real columns directly from schema.ts
- [x] Categorized 213 business-domain tables across the 8 in-scope domains (CRM 8, Sales 19, Purchase 27, Inventory 17, Accounting/GST 41, HR 43, PM 27, Helpdesk 13, Construction/BoQ 18), each with real file:line + real column list
- [x] Enumerated all 959 real API route.ts files under src/app/api (note: relative-path `find` silently truncated to 51 in this shell -- absolute-path `find` gave the real count; used absolute-path form throughout), categorized 508 of them into the 8 domains by directory, with real per-directory counts + example paths (fixed an erp/returns sales-vs-purchase mis-split along the way)
- [x] Confirmed PROJEXA's module-chain exposure via PR #609 (compliance-tracker, merged 2026-07-28T04:11:24Z) + PR #59 (projexa, merged 2026-07-28T03:19:17Z): buildCapabilityTree() now exposed to PROJEXA's chat composer (minus construction_intelligence, which PROJEXA already owns via its own dedicated route) -- read the actual route.ts + capability-tree-service.ts source, not just PR titles
- [x] Ran both spec sanity checks: `grep -c "pgTable("` = 0 (real finding: this codebase uses `complianceSchemaDB.table(`/`platformSchemaDB.table(`, not literal `pgTable(` -- documented, not silently worked around) + real `.table(` count = 464; `git log` on PHASE_0_BASELINE.yaml confirmed empty (pre-creation)

- [x] Assembled ai-os/tasks/sap_mapping/PHASE_0_BASELINE.yaml (213 tables + 508 API routes across 8 domains, PROJEXA module-exposure section, sanity checks, out-of-scope notes) -- fixed one auto-generated-description false positive along the way (erpItems mis-labeled "line items" purely because its table name ends in _items; it's actually the item master)
- [x] Committed + pushed (commit b1631f6e)
- [x] Opened PR #615: https://github.com/FChecklist/compliance-tracker/pull/615
- [x] Updated ACTIVE-CLAIMS.yaml entry with PR #615 status (will move to recently_completed once merged)

## Remaining
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

# PROGRESS -- task-20260728-051737-owner-engine-phase-8-real-gaps

Closes the 5 real, audit-confirmed unbuilt Phase 8 gap items:
engine-prompt-translation, engine-prompt-localization,
engine-prompt-marketplace, engine-prompt-export, engine-prompt-import.
Source of truth for scope: `ai-os/audits/owner_engine_reaudit_2026-07-27.md`
(merged) + `ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`
(`phase_8_dspy_learning_distribution_engines`) in the sibling
`claude-control` repo, read read-only. Extends the existing Prompt
Operating System (`prompt-os-resolver.ts` / `prompt-os-service.ts`, Wave
22/23) rather than a parallel prompt-management layer, per this task's
CONSTRAINTS.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, CONSTITUTION, OS.yaml, MASTER-TRACKER), registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`, moved the stale PR #589 "increment 1" claim to `recently_completed`.
- [x] Read authoritative phase_8 scope from claude-control's `VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml` and the re-audit report.
- [x] Confirmed PR #561's `scripts/export-prompt-versions-gitops.ts` is a one-way DB->git GitOps exporter (no import counterpart, whole-registry, not a portable single-template bundle) -- distinct from this task's engine-prompt-export/import scope.
- [x] Surveyed existing conventions to reuse: `resolveModelConfig()`+`callLLMJson()` (llm-client.ts) for real LLM calls, `ai-response-locale.ts` for the known-locale list, `permission-service.ts`'s `PROMPT_ACTION_ROLES`, `workerAgents`' platform-wide draft->published pattern (precedent for marketplace scope: platform-wide, orgId nullable/attribution-only, not new cross-tenant RLS).
- [x] Schema: added `prompt_translations`, `prompt_localizations`, `prompt_marketplace_listings` tables to `src/lib/db/schema.ts` + hand-authored `drizzle/0268_prompt_translation_localization_marketplace.sql` (not applied live, same convention as drizzle/0262 -- left for the supervising session).
- [x] `src/lib/services/prompt-translation-service.ts` + test (6 tests): real LLM translation via `resolvePlatformModelConfig()`+`callLLMJson()`, cached per (versionId, locale), `force` re-translates.
- [x] `src/lib/services/prompt-localization-service.ts` + test (5 tests): second real LLM pass on top of a translation, grounded in real `Intl.DateTimeFormat`/`Intl.NumberFormat` samples (`localeFormattingSamples()`, pure/unmocked-tested), translates on demand if no translation exists yet.
- [x] `src/lib/services/prompt-marketplace-service.ts` + test (7 tests): publish (Production-lifecycle-only gate), unlist, list (read-only, no admin gate).
- [x] `src/lib/services/prompt-export-import-service.ts` + test (9 tests): portable single-template JSON bundle export + validated re-import (creates template if missing, append-only Draft versions, content-based idempotent re-import skip).
- [x] Permission entries in `permission-service.ts`: `prompt.translation.create`, `prompt.localization.create`, `prompt.marketplace.publish`, `prompt.import.run` all `veridian_admin` (export is intentionally ungated/read-only, same posture as the existing `GET /api/settings/prompts`).
- [x] API routes: `src/app/api/prompt-os/{translate,localize,export,import}/route.ts`, `src/app/api/prompt-marketplace/route.ts` -- all `requireAuth()`-gated, `ServiceError`-aware error mapping.
- [x] Real screen: `src/app/(app)/prompt-marketplace/page.tsx` (+ `AppSidebar.tsx` nav entry, `messages/en.json`+`hi.json` i18n keys) -- browse listings, publish dialog scoped to Production-lifecycle versions pulled from `/api/settings/prompts`.
- [x] Fixed 3 real bugs found while verifying the four new `*.test.ts` files (all originally failing, not a pre-existing-suite issue):
  1. All 4 test files' `mock.module("@/lib/db", ...)` factories replaced the *entire* `@/lib/db` module namespace, which broke the transitive `import { ServiceError } from "./compliance-service"` every new service uses (that file itself imports `auditLogs`/`complianceItems`/etc. from `@/lib/db`, which then didn't exist on the mocked module). Fixed by spreading the real (lazy, connection-free-on-import) module first: `{...(await import("@/lib/db")), ...dbMocks}`.
  2. `prompt-localization-service.test.ts`'s `mock.module("./prompt-translation-service", () => ({..., ServiceError: (await import(...)).ServiceError}))` used `await` inside a non-async factory arrow -- syntax error. Fixed by resolving `ServiceError` before the `mock.module()` call and referencing the plain binding inside.
  3. Both `prompt-translation-service.test.ts` and `prompt-localization-service.test.ts`'s "throws when no AI model is configured" tests set `modelConfig: null` but the mock read it via `opts.modelConfig ?? default`, and `??` treats `null` the same as "absent" -- the default config was used instead of `null`, so the test never exercised the intended path and crashed elsewhere. Fixed with `"modelConfig" in opts ? opts.modelConfig : default`.
- [x] `npx tsc --noEmit` clean (needs `NODE_OPTIONS="--max-old-space-size=8192"` in this environment -- default heap OOMs on this repo's size, unrelated to this task).
- [x] `bun test` scoped to the 4 touched test files: 27/27 pass. Full-repo `bun test`: 2255/2258 pass; the 3 failures are pre-existing on this branch before any of this task's changes (verified via `git stash`) and are in unrelated files (`dispatch-completion-monitor.test.ts`, `roster-overrides.test.ts`, `defense-in-depth.test.ts`) -- not caused by this work.

- [x] Committed + pushed, opened PR #618 (no self-merge -- awaiting a fresh supervisor audit per AGENTS.md Rule 7(c)/Rule 10). Updated `ai-os/boss/ACTIVE-CLAIMS.yaml`'s claim entry with a status update.

## Remaining
- [ ] Fresh supervisor audit of PR #618 (mandatory, this session may not self-certify).
- [ ] Supervising session applies `drizzle/0268_prompt_translation_localization_marketplace.sql` live (not applied in this PR).

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
