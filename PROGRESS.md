# PROGRESS -- task-20260731-042721-rebase-pr-643--calc-engines-rescue--clea

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain + `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting.
- [x] Identified the real task: PR #643 (`worker/task-20260730-041950-build-extend-calculation-track-engines`,
      DIRECTIVE-001-PHASE-3-BUILD-CALC) is `mergeable: false` / `mergeable_state: dirty` against current
      `origin/main` (11db691a) -- 10 of 14 sibling Task #17 SAP-report PRs have merged since #643 opened,
      several covering the exact same ground.
- [x] Found a prior invocation of this same task had already reached this same conclusion and left the
      evidence mid-write: an uncommitted `ai-os/boss/ACTIVE-CLAIMS.yaml.tmp.*` atomic-write temp file with the
      full analysis, plus partially-applied code changes in `erp-accounting-service.ts` /
      `erp-financial-report-service.ts`. Independently re-verified every claim in it against `origin/main` and
      the live `gh` API before trusting it (did not take the tmp file on faith):
      - FI-AR-006 `customerPaymentBehaviorReport` -- confirmed ALREADY MERGED (PR #645), in
        `erp-invoicing-service.ts` (different file/impl than #643's `erp-payment-entries-service.ts` version).
      - FI-AP-006 `vendorPaymentBehaviorReport` -- confirmed ALREADY MERGED (PR #651), same file as above.
      - FI-AA-006 `assetToGlReconciliation` -- confirmed ALREADY MERGED (PR #648, `state: closed, merged:
        true`), in `erp-fixed-assets-service.ts` -- main's version is a materially more complete per-category
        reconciliation than #643's single-control-account one.
      - FI-GL-007 `subledgerReconciliationToGl` -- confirmed NOT merged, but PR #647
        (`feat/fi-gl-007-subledger-gl-reconciliation`, `state: open`, `mergeable: true`) already builds the
        identical gap (`subledgerToGlReconciliation()`) with a report_definitions row, API route, and 11 unit
        tests -- #643's version has none of that. Dropped to avoid landing a thinner duplicate next to a
        more-complete in-flight PR for the same gap.
      - CO-001 `listJournalEntryLinesByCostCenter`, CO-003 `costCenterHierarchyReport`, FI-GL-002
        `glAccountBalanceDisplay`, FI-GL-008 `glAccountGroupBalancesSummary` -- grepped all four names
        repo-wide: confirmed NOT present anywhere on current main and not claimed by any other open PR.
        Genuinely still-needed work -- kept.
- [x] Net result: rebased PR #643 onto current `origin/main`, keeping only the 4 surviving functions in
      `erp-accounting-service.ts` (CO-001/CO-003) and `erp-financial-report-service.ts` (FI-GL-002/FI-GL-008).
      Dropped entirely: the `erp-payment-entries-service.ts` (+ its test file) / `erp-fixed-assets-service.ts` /
      `erp-invoicing-service.ts` diffs (fully superseded by #645/#648/#651), and the stray `package-lock.json`
      the original dead-sandbox attempt had generated (this repo is Bun-based, uses `bun.lock`, not npm --
      confirmed via `git ls-files` that no `package-lock.json` was ever tracked here).
- [x] `wiring_registry` (`/opt/veridian/ai-os/memory/superboss-register.sqlite`) already had `VERIFIED_MATCH`
      entries for all 4 kept functions from the original PR #643 work (`function_name`/`sap_report_ids`
      metadata confirmed for `listJournalEntryLinesByCostCenter`/CO-001, `costCenterHierarchyReport`/CO-003,
      `glAccountBalanceDisplay`/FI-GL-002, `glAccountGroupBalancesSummary`/FI-GL-008) -- no re-registration
      needed.
- [x] Updated `ai-os/boss/ACTIVE-CLAIMS.yaml`: applied the prior invocation's already-drafted correcting claim
      entry (appended after the stale `task-20260730-041950` entry rather than editing it in place, per this
      file's own "note it, don't silently work around it" protocol) documenting the above.

## Remaining
- [ ] Verify: `tsc --noEmit` clean, `bun test` full suite passes (no regressions from the kept
      CO-001/CO-003/FI-GL-002/FI-GL-008 diffs).
- [ ] Commit and force-push the cleaned, rebased history to PR #643's existing branch
      (`worker/task-20260730-041950-build-extend-calculation-track-engines`) -- same PR, not a new one.
- [ ] CI + merge on PR #643 (per AGENTS.md Rule 6, no self-merge without CI green).
- [ ] Once merged: move this task's + the superseded `task-20260730-041950` ACTIVE-CLAIMS.yaml entries to
      `recently_completed`.
- [ ] Not this task's job, left for whoever owns it: PR #647 (FI-GL-007) is still open/blocked -- its own
      merge is unaffected by this rebase.
