# PROGRESS -- rebase-1530-final (real rebase-merge for PR #1530, second replacement for original PR #579)
## Scope
Real rebase-merge of PR #1530 (`rebase-final-579`, "V2-11: Delegation expiry
enforcement audit + wire into 2 real checkpoints [was #579]") onto current
main, per this repo's standard rebase-sweep protocol. Original PR content
(already independently reviewed and approved by the owner, not
re-litigated here): real broken-access-control vulnerability -- a low-rank
user could self-grant payment-approval authority via delegation.
`isDelegatedByAuthorizedDelegator()` (`src/lib/services/delegation-
service.ts`) is wired into `decideApprovalStep()`
(`approval-workflow-service.ts`) and the new `canDecidePaymentEntry()`/
`decidePaymentEntry()` gate (`erp-payment-entries-service.ts`), checking the
delegator's own rank (>= MANAGER_RANK) before honoring a delegation. #1530
was itself already a rebase-replacement for the original PR #579; main
moved further (4 commits: #1529/#1531/#1533/#1532) before #1530 could be
merged, so a second rebase was needed -- done here directly on #1530's own
head branch (`rebase-final-579`) rather than opening a third PR number.
Owner has explicitly approved "merge as-is" after resolving the one open
policy question below -- no further review needed.
## Completed
- [x] Worktree: `git worktree add -b rebase-1530-final` from
      `origin/rebase-final-579` (PR #1530's own head), `bun install` (1273
      packages).
- [x] `git merge origin/main` -- 1 real conflict: `PROGRESS.md` (this
      repo's single-current-entry convention, replaced wholesale with this
      entry). `ai-os/boss/ACTIVE-CLAIMS.yaml` and `ai-os/registry/
      terminology-guardrail-exemptions.yaml` merged automatically with no
      conflict -- neither #579/#1530 nor this rebase's own commits ever
      touch either file (confirmed via `git diff <merge-base>`), so main's
      current pruned/rotated `ACTIVE-CLAIMS.yaml` was taken as-is; appended
      this task's own claim entry under `active:` on top of it, matching
      the precedent already recorded in that same file (the
      rebase-final-1019 and rebase-1014-fixed entries). No `drizzle/`
      conflicts and no migration files in this PR at all (confirmed via
      `git diff <merge-base> -- drizzle/`), so no journal renumbering was
      needed.
- [x] **Policy question resolved (was the sole blocker on #1530's own prior
      PROGRESS.md entry)**: current main's branch-protection required
      checks are Lint/Type Check/Build/Unit Tests only -- the
      `mandatory-audit-check` CI gate (and `scripts/validate-audit-
      verdict.ts`) was repo-wide removed 2026-08-18 (commit `c37f91c9`),
      before this PR's branch was cut, which is why its last CI run still
      carried a stale pre-fix FAIL verdict from the old gate. Owner
      confirmed the current no-audit-check convention is intentionally
      sufficient for this PR too, matching every other PR now merging under
      it -- no fresh manual security re-review required. Owner instruction:
      "merge as-is".
- [x] Security-relevant checkpoints re-verified directly against the final
      merged tree (not just the original PR description): both
      `decideApprovalStep()` and `decidePaymentEntry()`/
      `canDecidePaymentEntry()` still call `isDelegatedByAuthorizedDelegator()`
      correctly post-merge -- the unrelated `PROGRESS.md` conflict did not
      touch either service file, so no risk of the fix being silently
      dropped during resolution.
- [x] `node scripts/check-governance-yaml-parse.mjs` -- clean.
- [x] `bunx tsc --noEmit` -- clean, 0 errors.
- [x] `bun test src/lib/services/delegation-service.test.ts
      src/lib/services/approval-workflow-service.test.ts
      src/lib/services/erp-payment-entries-service.test.ts` -- all touched
      test files pass.
- [x] Pushed `rebase-1530-final` directly to PR #1530's own existing head
      branch (`rebase-final-579`) -- no new PR number needed.
## Remaining
- [ ] Verify real CI on PR #1530 (`gh pr checks 1530`) -- retry on
      transient network errors up to 5 times; ignore known-ambient
      failures (E2E Tests, Vercel org-wide deployment-blocked, Secret
      Scanning on pre-existing files, Promptfoo Evals).
- [ ] Merge PR #1530 only when genuinely green (modulo the known-ambient
      ones): `gh pr merge 1530 --squash --delete-branch`.
- [ ] Independently verify post-merge via `gh pr view 1530
      --json state,mergedAt` -- do not just trust the merge command's exit
      code.
