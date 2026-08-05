# Metadata Index Coverage Check Hardening -- Real Verification Record

**Real dispatch instruction:** `UMR-20260805-033159-4f47` (PM decision citing this finding), plus `UMR-20260805-025349-a6b8`, `UMR-20260805-025554-46f9`, and the standing Hard Rule 7 lock `UMR-20260802-165606-4413`.
**Related:** `UMR-20260805-034917-33a9` (the real corrective action this record verifies -- see below, already applied by a prior session), `UMR-20260805-091648-6793` (the real, still-active, still-conditioned exception this record does **not** override).

This record honestly documents what this task found, what it independently verified, and what it deliberately did **not** do and why -- same discipline as `ai-os/GOVERNANCE_RECORD_HARD_RULE_7_VIOLATION_PR886_2026-08-05.md` and `ai-os/GOVERNANCE_RECORD_TEMPORARY_REVIEW_COUNT_EXCEPTION_2026-08-05.md`.

## The real finding this task was dispatched against

The Metadata Index Coverage Check and a minimum real approving-review count were never in `compliance-tracker`'s real required status checks on `main`, which is why PR #932 and PR #933 were able to merge while the Metadata Index Coverage Check still showed a real failing state, and with zero real approving reviews.

## Real "before" state this task independently confirmed (not assumed)

`gh api repos/FChecklist/compliance-tracker/branches/main/protection` was already showing, at the moment this task started (2026-08-05):

```json
{
  "required_status_checks": {
    "contexts": ["Lint", "Type Check", "Build", "audit-check", "Guardrail Presence Check",
                 "Asset Registry Coverage Check", "Unit Tests", "Metadata Index Coverage Check"]
  },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "enforce_admins": { "enabled": true }
}
```

## What this task discovered: the corrective action was already real and already applied -- once

Independently confirmed via `ai-os/GOVERNANCE_RECORD_TEMPORARY_REVIEW_COUNT_EXCEPTION_2026-08-05.md` and `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md`, both already merged to `main`: a prior session, under `UMR-20260805-034917-33a9`, already made the exact real change this task's SPEC asks for -- added `Metadata Index Coverage Check` to `required_status_checks.contexts` **and** set `required_approving_review_count: 1`, plus `enforce_admins: true`. That prior action's own described trigger (PRs #932/#933 merging with a failing required check and zero reviews) is the same finding this task's SPEC restates. This task's dispatch is a duplicate of already-completed corrective action for the review-count half, and the check half genuinely never regressed.

**What changed since:** a second, later, real Owner directive (`UMR-20260805-091648-6793`) independently confirmed that with only one real GitHub identity (`FChecklist`) in this entire system authoring every PR, `required_approving_review_count: 1` combined with `enforce_admins: true` (no bypass) made **every** future merge in this repo structurally impossible -- GitHub refuses self-approval outright. The Owner explicitly, temporarily, and narrowly authorized reverting `required_approving_review_count` to `0` to unblock ~12 already-fixed, already-`AUDIT: PASS`-reviewed queued PRs, with a precise, documented re-enable trigger: the moment a real second reviewer identity (`UMR-20260805-091629-d8e3`) goes live.

**Independently re-verified this session that the re-enable trigger has NOT fired:** `UMR-20260805-091629-d8e3`'s identity-mismatch *check code* merged (PR #938, confirmed via `git log --all --oneline --grep=d8e3`), but the actual GitHub Actions workflow that would run it is still only staged (`ai-os/registry/PENDING-MANUAL-APPLICATION-reviewer-not-author-check.yml.txt`, not present under `.github/workflows/`), and no second real GitHub identity or App exists yet (`ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md` -- this requires the Owner to create a GitHub App; not achievable by any automated session with the credentials available in this environment).

## The real decision this task made, and why

**Did not** set `required_approving_review_count` back to `1`. Doing so now, with `enforce_admins: true` and no second reviewer identity actually live, would not "hardening" the repo -- it would silently override a later, explicit, Owner-approved, still-valid exception before its own documented trigger condition was met, and would immediately re-lock every future merge in `compliance-tracker` (self-approval is structurally impossible; there is no admin bypass). That is a materially worse, and much harder to walk back in practice, outcome than the gap this task was dispatched to close. Flagging this honestly here rather than either silently skipping the ask or silently overriding a documented Owner decision.

**Did** independently re-verify, with a real synthetic test, that the half of this task's ask which genuinely is live and enforced right now -- the Metadata Index Coverage Check itself -- actually blocks a real merge. See below.

## Real synthetic test performed

1. Opened a real throwaway branch off `origin/main`, `synthetic-test/metadata-index-coverage-block-check-20260805`, adding exactly one new top-level file directly under `ai-os/` (`ai-os/SYNTHETIC_METADATA_INDEX_COVERAGE_TEST_DELETE_ME.md`) with **no** matching `index`/`exempted` entry in `ai-os/OS.yaml` -- the deterministic failure condition `scripts/check-metadata-index-coverage.mjs` checks for.
2. Opened real PR **#942** (`FChecklist/compliance-tracker`) from that branch against `main`.
3. Real CI ran. Confirmed via `gh pr checks 942`: **`Metadata Index Coverage Check` = `fail`** (job: `github.com/FChecklist/compliance-tracker/actions/runs/31006117543`).
4. Confirmed via `gh pr view 942 --json mergeStateStatus,mergeable`: **`mergeStateStatus: BLOCKED`**, `mergeable: MERGEABLE` -- i.e. genuinely blocked by a required check, not by a merge conflict. The real merge button was confirmed blocked.
5. Closed PR #942 without merging (`gh pr close 942 --delete-branch`), real branch deleted. No `main` change resulted from this test.

## Honest before/after summary

| | Metadata Index Coverage Check required? | required_approving_review_count |
|---|---|---|
| **Before this task's SPEC was written** (PR #932/#933 era) | No | 0 |
| **Before this task started** (already fixed by `UMR-20260805-034917-33a9`, then partially, deliberately relaxed by `UMR-20260805-091648-6793`) | **Yes** | 0 (temporary, bounded, still-active exception) |
| **After this task** | **Yes** (independently re-verified live, real synthetic-test-proven to block merge) | 0, unchanged -- deliberately not touched, see decision above |

## Real citations

- `UMR-20260805-033159-4f47` (this task's own SPEC finding)
- `UMR-20260805-034917-33a9` (the real corrective action already applied, before this task started)
- `UMR-20260805-091648-6793` / `ai-os/GOVERNANCE_RECORD_TEMPORARY_REVIEW_COUNT_EXCEPTION_2026-08-05.md` (the real, still-active exception this task did not override)
- `UMR-20260805-091629-d8e3` / `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md` (the real, unmet re-enable trigger)
- Real throwaway PR #942 (synthetic test, opened and closed this session, never merged)
