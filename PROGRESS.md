# PROGRESS -- rebase-final-579 (real rebase-merge for PR #579)

## Scope
Real rebase-merge of PR #579 (`worker/task-20260726-171939-delegation-expiry-enforcement-audit---te`,
head 00731620) onto current main, per this repo's standard rebase protocol. Decision context:
real broken-access-control vulnerability -- a low-rank user could self-grant payment-approval
authority via delegation. PR head's `isDelegatedByAuthorizedDelegator` (wired into
`decideApprovalStep` and the new `canDecidePaymentEntry`/`decidePaymentEntry` gate in
`erp-payment-entries-service.ts`) closes the hole by checking the delegator's own rank
(>= MANAGER_RANK) before honoring a delegation. Confirmed via diff against current main: main
has no delegation-based approval-authority logic at all (gates purely on ROLE_RANK +
isSelfApproval), so this whole feature -- and its self/accomplice-grant vulnerability -- is new
to this PR branch and never shipped to main. Nothing invalidates the original decision.

## Completed
- [x] Worktree: `git worktree add -b rebase-final-579` from
      `origin/worker/task-20260726-171939-delegation-expiry-enforcement-audit---te`,
      `bun install` (1204 packages).
- [x] `git merge origin/main` -- 1 real conflict: `src/lib/services/erp-payment-entries-service.ts`
      import block (add/add, non-competing) -- this PR added
      `import { isDelegatedByAuthorizedDelegator } from "./delegation-service"`, main
      independently added `import { ErpContext } from "./actor-context"` for the same file
      (both symbols are used later in the file, by different functions) -- kept both imports.
      `PROGRESS.md` auto-merged to stale PR #664 content (single-current-entry convention
      violated by the automatic merge) -- replaced wholesale with this entry.
- [x] **Significant finding, not previously known to the task orchestrator**: current main no
      longer has any `mandatory-audit-check` CI gate. Commit `c37f91c9` ("chore: remove dispatch
      machinery workflows and guardrail scripts (#1301)", authored by the repo owner,
      2026-08-18) deleted `.github/workflows/mandatory-audit-check.yml` and
      `scripts/validate-audit-verdict.ts` repo-wide and explicitly reduced branch-protection
      required checks to Lint / Type Check / Build / Unit Tests. PR #579's branch predates that
      removal, which is why its CI still ran the old `audit-check` job and returned a stored
      FAIL verdict (from before the `isDelegatedByAuthorizedDelegator` fix commits) via
      `validate-audit-verdict.ts`'s DB lookup rather than a live re-analysis. After this rebase
      onto current main, `mandatory-audit-check.yml` is gone from the branch (deleted by the
      merge, following main) -- there is no `audit-check` job left to pass or fail on the
      replacement PR. This is a repo-wide policy change discovered mid-task, not something
      specific to this PR, and needs an explicit owner call before merge (see Remaining).
- [ ] Validate for real: `node scripts/check-governance-yaml-parse.mjs`, `bunx tsc --noEmit`,
      `bun test` for touched test files.
- [ ] Push `rebase-final-579`, open replacement PR "... [was #579]", close #579 pointing to it.
- [ ] Check real CI on the replacement PR.

## Remaining
- [ ] **BLOCKED on owner decision**: this is a security-relevant PR (broken-access-control fix)
      gated by an explicit instruction not to merge without a genuinely passing audit-check.
      The only audit-check verdict ever recorded for this PR is FAIL (stale, pre-fix), and the
      mechanism that could produce a fresh verdict (`mandatory-audit-check.yml` +
      `validate-audit-verdict.ts`) has been repo-wide retired from main since 2026-08-18, before
      this task started. Do NOT merge until the owner either (a) confirms current CI convention
      (Lint/Type Check/Build/Unit Tests, no audit-check) is intentionally sufficient for this
      PR too, matching how every other PR is now treated, or (b) arranges a fresh manual/human
      security review of the delegation-authority fix and records that verdict somewhere
      checkable, given the only existing verdict predates the fix and was never re-run against
      it.
- [ ] Re-run full validation + CI checks on the replacement PR once opened.
