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
was itself already a rebase-replacement for the original PR #579; main kept
moving before #1530 could be merged, so this rebase was done directly on
#1530's own head branch (`rebase-final-579`) across two rounds rather than
opening a third PR number. Owner has explicitly approved "merge as-is"
after resolving the one open policy question below -- no further review
needed.
## Completed
- [x] Worktree: `git worktree add -b rebase-1530-final` from
      `origin/rebase-final-579` (PR #1530's own head), `bun install` (1273
      packages).
- [x] `git merge origin/main`, round 1 (main 4 commits ahead: #1529/#1531/
      #1533/#1532) -- 1 real conflict: `PROGRESS.md` (this repo's
      single-current-entry convention, replaced wholesale with this entry).
      `ai-os/boss/ACTIVE-CLAIMS.yaml` and `ai-os/registry/terminology-
      guardrail-exemptions.yaml` merged automatically with no conflict --
      neither #579/#1530 nor this rebase's own commits ever touch either
      file (confirmed via `git diff <merge-base>`), so main's current
... more files changed
