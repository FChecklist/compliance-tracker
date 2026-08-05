# PROGRESS -- task-20260805-122949-pm-decision--harden-compliance-tracker-b

SPEC: PM decision, real corrective action for the finding delivered by
`UMR-20260805-033159-4f47` (related: `UMR-20260805-025349-a6b8`,
`UMR-20260805-025554-46f9`, Hard Rule 7 lock `UMR-20260802-165606-4413`) --
add the Metadata Index Coverage Check to `compliance-tracker`'s real
required status checks, and require >=1 real approving review before
merge, then prove it with a real synthetic failing throwaway PR.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` per Rule 11 before starting.
- [x] Verified real, LIVE branch-protection state via
      `gh api repos/FChecklist/compliance-tracker/branches/main/protection`.
- [x] Discovered this exact corrective action was **already applied** by a
      prior session under `UMR-20260805-034917-33a9`: both
      `Metadata Index Coverage Check` added to `required_status_checks.contexts`
      AND `required_approving_review_count: 1` were set, `enforce_admins: true`.
      That matches this task's own described finding (PRs #932/#933 merged
      with a failing required check and zero reviews) almost verbatim.
- [x] Discovered a second, later, real Owner-approved change on top of that:
      `UMR-20260805-091648-6793` **temporarily reset
      `required_approving_review_count` back to `0`**, because the only real
      GitHub identity in this system (`FChecklist`) authors every PR, so
      GitHub structurally refuses self-approval -- with `enforce_admins: true`
      and no bypass, review_count=1 made every future merge in this repo
      impossible until a second reviewer identity exists. This exception is
      documented, bounded, and still active:
      `ai-os/GOVERNANCE_RECORD_TEMPORARY_REVIEW_COUNT_EXCEPTION_2026-08-05.md`.
      Its own documented re-enable trigger (`UMR-20260805-091629-d8e3`, a real
      second reviewer identity going *live*) has **not** fired -- confirmed:
      the identity-mismatch check code merged (PR #938), but the workflow
      file remains unapplied (`ai-os/registry/PENDING-MANUAL-APPLICATION-
      reviewer-not-author-check.yml.txt`, blocked on this token lacking
      `workflow` OAuth scope) and no second real GitHub identity/App exists
      yet (`ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md` --
      requires the Owner to create a GitHub App; not achievable by any
      automated session with current credentials).
- [x] Decision: do **not** blindly flip `required_approving_review_count`
      back to `1` -- that would silently override a later, explicit,
      Owner-approved, still-valid, still-conditioned exception without its
      own documented trigger having fired, and would re-lock every future
      merge in the repo (self-approval is structurally impossible, no
      `enforce_admins` bypass). Documented this honestly instead of either
      silently skipping it or silently overriding the exception.
- [x] Confirmed `Metadata Index Coverage Check` portion of the ask IS live,
      real, and enforced right now (independent of the review-count
      question) -- proceeded to prove it with a real synthetic test.
- [x] Real synthetic test: opened real throwaway PR #942 off `main`, added
      one new top-level file directly under `ai-os/`
      (`ai-os/SYNTHETIC_METADATA_INDEX_COVERAGE_TEST_DELETE_ME.md`) with no
      matching `index`/`exempted` entry in `ai-os/OS.yaml`. Confirmed via
      `gh pr checks 942`: `Metadata Index Coverage Check: fail`. Confirmed
      via `gh pr view 942 --json mergeStateStatus,mergeable`:
      `mergeStateStatus: BLOCKED`, `mergeable: MERGEABLE` (blocked by the
      required check, not a conflict). Closed PR #942 without merging,
      deleted the throwaway branch. No change landed on `main` from this
      test.
- [x] Wrote permanent governance record:
      `ai-os/GOVERNANCE_RECORD_METADATA_CHECK_HARDENING_VERIFICATION_2026-08-05.md`,
      indexed it in `ai-os/OS.yaml`.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      (`recently_completed`, since the work closed same-session).
- [x] Ran `node scripts/check-metadata-index-coverage.mjs` locally --
      passes with the new governance doc indexed.
- [x] Committed and pushed this branch; opened real PR against `main` for
      independent review/CI per Rule 6 (docs-only diff; no branch-protection
      setting was actually changed by this task -- see governance record for
      why).

## Remaining
- [ ] None. Task complete pending this PR's own CI + merge.
