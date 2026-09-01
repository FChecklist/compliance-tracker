# PROGRESS -- rebase-sweep2b-1037 (real rebase-merge for PR #1037)
## Scope
Real rebase-merge of PR #1037 (`worker/task-20260718-171005-cognitive-architecture--deterministic-fi`,
"Cognitive Architecture: Deterministic-First Principles: deterministic-first riskLevel for
detectBudgetScheduleRisk()") onto current main, per this repo's standard rebase-sweep protocol.
Prior triage + adversarial-verify (already complete before this sweep, not re-done here)
independently re-confirmed the gap is still real and unaddressed on current main:
`detectBudgetScheduleRisk()` (`src/lib/services/construction-ai-service.ts`) still throws when no
AI model is configured for an org, and `riskLevel` is still decided purely by the LLM from numeric
aggregates (`variance`, `delayedTaskCount`/`totalTaskCount`) with no deterministic path at all --
no `classifyBudgetScheduleRisk()` or `templateBudgetScheduleRisk()` exists on main. All 18 required
checks on the original PR passed (Lint/Type Check/Build/Unit Tests/E2E/audit-check/Guardrail
Presence/Asset Registry Coverage/Metadata Index Coverage/Terminology Guardrail/doc checks/Secret
Scanning/Security Pattern etc.) -- only `Vercel` (rate-limited preview deploy, not required) was
non-green. Additive, deterministic-first fix to an internal AI-classification helper -- no
auth/payment/destructive-data logic touched.
## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2b-1037` from
      `origin/worker/task-20260718-171005-cognitive-architecture--deterministic-fi`, `bun install`
      (1203 packages, clean single pass).
- [x] Independently re-confirmed the PR's real source diff before merging: the sole functional
      commit (`8a6f4cca`, "Cognitive Architecture: deterministic-first riskLevel for
      detectBudgetScheduleRisk") adds a pure, most-severe-first `classifyBudgetScheduleRisk()`
      threshold function (same style as `risk-classification.ts`'s `classifyRisk()`) over
      overspend-ratio and delayed-task-ratio, plus a `templateBudgetScheduleRisk()` deterministic
      fallback reasoning generator, to `src/lib/services/construction-ai-service.ts`.
      `detectBudgetScheduleRisk()` now always computes `riskLevel` deterministically; the LLM call
      (when a model is configured) is used only for reasoning prose, and its own `riskLevel` output
      is always discarded and overridden. When no AI model is configured, it now returns the real
      deterministic template result instead of throwing 400. New `construction-ai-service.test.ts`
      (11 tests) covers on-budget/under-budget, medium/high overspend thresholds, medium/high
      delayed-ratio thresholds, "the more severe of the two signals wins", and zero-budget/
      zero-tasks not dividing by zero. Subsequent commits on the branch were docs-only (PROGRESS.md/
      MASTER-TRACKER.yaml/ACTIVE-CLAIMS.yaml bookkeeping, an audit-check re-trigger sync commit, and
      a final-state note) -- no further functional changes to reconcile.
- [x] Merged `origin/main` (78 commits ahead at fetch time). 3 real conflicts, each resolved with
      genuine judgment, not blind ours/theirs:
      - `PROGRESS.md` (this file): this repo's single-current-entry convention -- replaced wholesale
        with this entry rather than concatenating the stale original-task entry with main's PR #1015
        entry.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml`: main had independently pruned the `active:` list to its
        current rolling set (legitimate cleanup per the file's own protocol #3) and, separately,
        fixed a real pre-existing bug where the OCID-046 entry's `claim:` body held the wrong
        (VERI_CHAT_MOCKUP) text -- took main's corrected/pruned version wholesale and re-appended
        this task's own claim (describing PR #1037's real work) at the end, per the standing
        precedent set by the `rebase-final-1019`/`rebase-1530-final`/`rebase-sweep2b-1015` entries
        already in that file.
      - `ai-os/MASTER-TRACKER.yaml`: this branch's `GAP-CONSTRUCTION-AI-RISKLEVEL-LLM-ONLY-
        CLASSIFICATION` entry (status: resolved) is purely additive -- main had no conflicting
        content in that span (git's diff3 flagged it only due to proximity to unrelated context
        changes) -- kept as-is.
      No `drizzle/` migration conflicts -- this PR never touches migrations, so no renumbering was
      needed.
- [x] Real validation on the merged worktree (not assumed carried over from the original PR's CI
      run): `node scripts/check-governance-yaml-parse.mjs`, `bunx tsc --noEmit`, `bun test` on the
      touched test file. See this session's own final report for exact pass/fail results.
- [ ] Push `rebase-sweep2b-1037`, open replacement PR ("... [was #1037]"), close #1037 as superseded,
      verify real CI green on the replacement, merge.
