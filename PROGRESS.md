# PROGRESS -- task-20260801-173901-retry-ai-engineering-quality-code-struct

VERIDIAN Review Framework gap-closure: AI Engineering Quality / Code
Structure & Modularity (5 findings). Redispatch of task-20260718-065002 --
this invocation resumed mid-flight work left by an earlier invocation of
this same task (see "Inherited state" below) rather than starting fresh.

## Completed

- [x] Read AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml governance chain.
      Claim was already registered by an earlier invocation of this task
      (commit `57a21930`, `ai-os/boss/ACTIVE-CLAIMS.yaml`'s `active:` list)
      with a real collision check against schema.ts/task-execution-engine.ts
      -- re-verified that check is still accurate: `gh pr diff <n>
      --name-only` against the current open-PR list confirms zero collision
      (PR #683 is a different, unrelated gap area; PR #635 touches
      schema.ts additively, not a physical-split scope).

- [x] **Inherited state audited before continuing** (this task's own
      instruction: "do not assume the gap description is still accurate").
      An earlier invocation had left real, uncommitted, mostly-correct work
      in the tree with **zero PROGRESS.md record of it** and one real bug:
      `src/lib/services/task-execution/engine-dispatch.ts`'s `dispatchEngine`
      was defined without an `export` keyword, while
      `task-execution-engine.ts` already imported `{ dispatchEngine }` from
      it -- a guaranteed `tsc` failure that had never actually been run to
      confirm. Fixed (added `export`) before doing anything else, then
      confirmed the rest of the inherited extraction was sound.

- [x] **Finding 1 (Code Modularity) -- task-execution-engine.ts split.**
      Confirmed real per direct read (2,567 lines, multiple distinct
      responsibilities). The inherited work already did the right split,
      now verified end-to-end:
      - `dispatchTool()` (structured/deterministic tool dispatch for the
        free-text planning path) extracted unchanged into
        `src/lib/services/task-execution/tool-dispatch.ts` (283 lines).
        Re-exported from `task-execution-engine.ts` (`export {
        dispatchTool }`) since it has real external callers
        (`app/api/v1/projexa/assistant/route.ts`,
        `lib/services/fde-service.ts`) that import it from the original
        path -- confirmed both still resolve correctly.
      - `dispatchEngine()` (the ~185-key VCEL calculation-engine dispatch
        switch, by far the largest single responsibility -- over half the
        original file) extracted unchanged into
        `src/lib/services/task-execution/engine-dispatch.ts` (1,268 lines,
        now properly exported). Only called internally by
        `executeEngineDispatch()`, not part of the file's external API --
        left un-re-exported, matching its actual usage.
      - `task-execution-engine.ts` itself: 2,567 -> 1,055 lines.
      - `scripts/check-guardrail-presence.mjs`'s `logActivity(` marker
        retargeted from `task-execution-engine.ts` to the new
        `tool-dispatch.ts` (the call site's real new home) -- the marker
        itself, not just the code, moved, so the guardrail stays live
        instead of silently stopping to check anything.
      - `ai-os/registry/terminology-guardrail-exemptions.yaml`: added
        exemption entries for the two new files' inherited dated
        gap-closure comments (3 + 4 `hardcoded_iso_date` findings,
        same reviewed-false-positive class as the pre-existing
        `task-execution-engine.ts` entry they moved out of).
      - Verified: `dispatchTool`/`dispatchEngine` have no other importers
        anywhere in `src/` that would break; `bun test
        src/lib/task-execution-engine.test.ts` -- 7 pass.

- [x] **Finding 1 (Code Modularity) -- schema.ts split: investigated,
      deliberately NOT done.** Confirmed real gap on direct read --
      `src/lib/db/schema.ts` is 11,466 lines, hundreds of tables, one file.
      Not attempted this session: 8 other currently-open PRs (#635, #653,
      #663, #664, #665, #666, #667, #668) are all actively appending new
      tables/columns to this exact file right now. A physical split into
      per-domain files re-exported from an index is the right end state,
      but doing it today would force every one of those in-flight PRs into
      a rebase/re-split conflict the moment schema.ts's physical layout
      changes -- a large, genuinely multi-session mechanical migration (not
      a same-PR-sized task), with a blast radius this task's own scope
      (4 other findings, one session) shouldn't take on unilaterally while
      that much concurrent traffic is live. Recommend as its own dedicated
      follow-up task once schema.ts's open-PR traffic quiets down, not
      bundled into this gap-closure pass.

- [x] **Finding 2 (Component Reusability) -- REUSABLE-UTILITIES.md.**
      Added at repo root (matching `CLAUDE.md`/`AGENTS.md`/`FOLLOWUPS.md`'s
      existing root-level-doc convention). Real, measured import counts
      (not estimates) across 3 categories -- core `src/lib/` cross-cutting
      helpers (`auth-guard.ts` used in 934 files, `db.ts` in 356,
      `tenant-scoped.ts` in 305, `audit.ts` in 105, down to
      `policy-enforcement-engine.ts` at 16), shared UI components
      (`button.tsx` 187, `card.tsx` 167, ... down to `ProjectPicker.tsx`
      at 11), and other genuinely cross-domain service helpers
      (`currency-format.ts`, `embeddings.ts`, `activity-log-service.ts`,
      `webhook-deliver.ts`, `org-license-service.ts`, each reused across
      multiple unrelated feature areas). Includes an "Honorable mentions"
      section for `StatusBadge`/`DataTable` -- clean, generic, but only
      2-3 real call sites today, flagged so new list/status screens reach
      for them instead of rolling their own. Explicitly documented as a
      periodic index, not CI-enforced (no automated drift check) --
      matches the "short index" scope the finding actually asked for, not
      a new registry/coverage-check class of thing.

- [x] **Finding 3 (Low Coupling / High Cohesion) -- FK constraints.**
      Confirmed real gap: 322 `orgId` + 46 `userId` columns across
      `schema.ts`, zero with a Drizzle `.references()` -- org/user scoping
      enforced entirely in application code today. Added
      `drizzle/0304_org_user_scope_fk_constraints.sql`: `NOT VALID` FK
      constraints (safe-for-live-large-table pattern -- enforces all new/
      updated rows immediately without a full-table lock or an
      all-or-nothing validation gate) on the 5 highest-traffic tables:
      `compliance_items.org_id`, `documents.org_id`,
      `notifications.user_id`, `audit_logs.{org_id,user_id}`,
      `tasks.{org_id,user_id}` -- plus supporting indexes on the
      previously-unindexed FK columns. Deliberately scoped to these 5, not
      all 322/46 columns (a much larger, separate undertaking; this is the
      "starting with" slice the finding itself asks for). Verified: every
      referenced column/table exists with the exact name used (checked
      each of the 5 tables' real column defs against the migration's SQL);
      `drizzle/meta/_journal.json` entry added (idx 281, tag
      `0304_org_user_scope_fk_constraints`); `node
      scripts/check-migration-collision.mjs` passes (no number collision
      against origin/main).

- [x] **Finding 4 (Design Pattern Consistency) -- requireAuth() lint
      rule.** Added `scripts/check-requireauth-presence.mjs`: fails if a
      `src/app/api/**/route.ts` calls neither `requireAuth()` nor has a
      reasoned entry in its `EXEMPT_ROUTES` allowlist (same
      reviewable-diff-guarantee class as `check-guardrail-presence.mjs`,
      documented honestly as such in its own header). Running it for real
      found one genuine, previously-undocumented gap:
      `src/app/api/ai/team/log-usage/route.ts` calls neither -- it's
      secret-gated (`AI_TEAM_LOG_SECRET` bearer header, called by
      `scripts/ai-workforce-agent.mjs` from GitHub Actions, no Supabase
      session possible), a legitimate exemption class already established
      for the internal cron routes, so added it to `EXEMPT_ROUTES` with
      that reason rather than forcing a session-auth requireAuth() call
      onto a route that structurally can't have one. Final tally: 927 of
      991 route.ts files call `requireAuth()` directly (93.5%), the other
      64 are now all documented exemptions, script passes clean.
      Self-anchored in `check-guardrail-presence.mjs`'s `REQUIRED_MARKERS`
      (the script file itself, not paired with a ci.yml marker -- see the
      CI-wiring note below for why).
      - ServiceError half of this finding: checked, not a real gap --
        `grep -rl "ServiceError" src/lib/services/*.ts` already matches
        51/51 top-level service files (100%), so there is no adoption gap
        to enforce; the requireAuth() script covers the actual open half
        of the finding.

- [x] **Finding 5 (File & Folder Organization) -- ai-os/ subtree
      consolidation: investigated, confirmed NOT a real gap, no change
      made.** Per this task's own instruction ("if the described gap
      doesn't match what you find in the code, say so rather than making
      an unnecessary change"): `ai-os/tree4-unified/`, `ai-os/audit-tree/`,
      and `ai-os/system-tree/` are not overlapping/duplicative --
      `ai-os/OS.yaml` (lines ~93-99) documents them as three deliberately
      sequential, distinct-purpose stages (Tree 1 = requirements
      transcription from the Owner's source docs, Tree 3 = audited
      code-grepped inventory of what's actually built, Tree 4 = the
      Tree-1-vs-Tree-3 gap comparison). No governance doc anywhere
      (`stale-doc-manifest.yaml`, `MASTER-TRACKER.yaml`, `OS.yaml`,
      `docs/master/INDEX.md`) actually directs consolidating these three
      trees as a trio -- `stale-doc-manifest.yaml` only quarantines
      specific already-superseded subfolders
      (`tree4-unified/50-completion-plan/archive/`,
      `audit-tree/archive/`), which is already done (bannered in place).
      The real prior consolidation this finding is likely echoing already
      happened (commit `78cc8ae4`, tree4-unified's gap backlog folded into
      `MASTER-TRACKER.yaml`) and `system-tree/` is still actively
      refreshed, not dead weight. Recommend closing this finding as
      resolved/premise-mismatched rather than forcing a restructuring
      pass on three directories that are working as designed.

- [x] Full verification pass (after all changes above): `NODE_OPTIONS=
      "--max-old-space-size=8192" bun x tsc --noEmit` -- clean, 0 errors.
      `bun test` -- 2,470 pass, 0 fail, 4,925 `expect()` calls (215 files;
      the handful of console.error lines in the output are intentional
      fail-closed-scenario test logging, not failures). `bun run lint` --
      0 errors, 3 pre-existing warnings in untouched files. All 8
      `check-*.mjs` CI gates re-run locally and pass: guardrail-presence
      (89 markers), requireauth-presence (927/991 + 64 documented
      exemptions), asset-registry-coverage (443 tables), metadata-index-
      coverage (112 items), terminology-guardrail --diff-only (0 new
      findings), migration-collision (0 collisions), doc-quarantine-banner
      (44 files), doc-cross-references (427 references resolved).
      `permission-service.ts` confirmed untouched (task constraint).

## Remaining

- [ ] **CI wiring for `check-requireauth-presence.mjs` is prepared but NOT
      pushed.** `.github/workflows/ci.yml` has a local, uncommitted
      `requireauth-presence` job (mirrors the existing `guardrail-presence`
      job exactly, calls the new script) -- but this session's `gh` token
      (account FChecklist) lacks the `workflow` OAuth scope, and GitHub
      rejects any push whose branch touches `.github/workflows/*.yml`.
      Directly confirmed this session (not assumed from memory): pushed a
      throwaway branch containing only the ci.yml change, got GitHub's
      exact "refusing to allow an OAuth App to create or update workflow
      ... without `workflow` scope" rejection, then discarded that branch.
      **This PR is therefore opened WITHOUT the ci.yml change** -- the
      script itself (`scripts/check-requireauth-presence.mjs`) is real,
      tested, and included; only its CI job registration is missing. The
      exact job block to add (paste into `.github/workflows/ci.yml` right
      after the `guardrail-presence` job) is:
      ```yaml
        requireauth-presence:
          name: requireAuth Presence Check
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v7
            - run: node scripts/check-requireauth-presence.mjs
      ```
      Once that's landed (by the Owner, or a token with `workflow` scope),
      also add the paired self-anchor marker back into
      `scripts/check-guardrail-presence.mjs`'s `REQUIRED_MARKERS`:
      `{ file: ".github/workflows/ci.yml", mustContain:
      ["check-requireauth-presence.mjs"] }` (deliberately left out of this
      PR too, since adding a marker that requires text that isn't actually
      in ci.yml yet would fail the Guardrail Presence Check on this exact
      PR).

- [ ] **Migration 0304's `VALIDATE CONSTRAINT` follow-up, as flagged in
      the migration's own header.** The 5 new FK constraints were added
      `NOT VALID` (enforces all new/updated rows immediately, doesn't
      touch existing rows or take a blocking full-table lock). Running
      `VALIDATE CONSTRAINT` against the live dataset to confirm zero
      pre-existing orphan rows (and fix any that are found) is a
      deliberately separate follow-up, not bundled into this migration --
      flagging it here so it isn't forgotten, not silently deferred.

- [ ] **schema.ts physical split** (see Finding 1 above) -- real gap,
      intentionally not attempted this session given 8 concurrently-open
      PRs actively touching that file. Recommend as its own dedicated
      task once that traffic quiets down.

- [ ] Awaiting fresh supervisor audit + PR merge (this task does not
      self-merge, matching every prior gap-closure task's own pattern in
      this file's history below). Once merged: move this task's
      `ai-os/boss/ACTIVE-CLAIMS.yaml` entry from `active:` to
      `recently_completed:`.

---

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
