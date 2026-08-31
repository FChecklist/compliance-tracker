# Temporary Review-Count Exception — Permanent Governance Record

**Real dispatch instruction:** `UMR-20260805-091648-6793` (PM decision, Owner directive)
**Related:** `UMR-20260805-034917-33a9` (the real branch-protection hardening this temporarily relaxes), `UMR-20260805-091629-d8e3` (the real second-reviewer-identity work that permanently resolves the underlying gap)

This record documents a real, knowingly-made, explicitly bounded and temporary exception to the branch-protection review requirement added by `UMR-20260805-034917-33a9`. It does not soften or reverse that hardening's own standing rule; it records one specific, time-boxed departure from it, the same discipline already established by `ai-os/GOVERNANCE_RECORD_HARD_RULE_7_VIOLATION_PR886_2026-08-05.md` for a different real violation class.

## Status: TEMPORARY EXCEPTION — ACTIVE, PENDING RE-ENABLE

## The real problem that triggered this

`UMR-20260805-034917-33a9` added `required_approving_review_count: 1` (plus `enforce_admins: true`) to `compliance-tracker`'s `main` branch protection, as real corrective action for a real finding: PRs #932/#933 had merged with a failing required check and zero reviews.

Independently confirmed this cycle: the only real GitHub identity in this entire system is the `FChecklist` account, which is also the sole account authoring and pushing every real PR. GitHub structurally refuses self-approval (`gh pr review --approve` → `"Review Can not approve your own pull request"`). With `enforce_admins: true`, there is no bypass. The real, direct consequence: **real independent review became structurally impossible**, and roughly 12 real, already-queued, already-fixed PRs (the OCID-012, OCID-013, OCID-021, OCID-022, OCID-023, and OCID-053 through OCID-061 real fixes) were genuinely stuck — not failing review, unable to ever receive one.

## The real Owner decision

Per `UMR-20260805-091648-6793`: **temporarily set `required_approving_review_count` back to `0` on `compliance-tracker`, real and immediate**, explicitly bounded and temporary, not a permanent reopening. Real change applied via `gh api --method PUT repos/FChecklist/compliance-tracker/branches/main/protection`, changing only `required_pull_request_reviews.required_approving_review_count` from `1` to `0`; every other field (`enforce_admins: true`, the full `required_status_checks.contexts` list including `Metadata Index Coverage Check`, `restrictions: null`, and all other flags) preserved unchanged from `UMR-20260805-034917-33a9`'s own real configuration.

Verified immediately after the change: PR #936 (already `AUDIT: PASS`-reviewed, previously blocked with `mergeStateStatus: BLOCKED` / `reviewDecision: REVIEW_REQUIRED`) flipped to `mergeStateStatus: CLEAN`, was re-triggered through the real supervisor pathway, and merged for real (merge commit `118e1e8f89b7a72541963317b23e92cf0a966761`, independently re-confirmed a real ancestor of `origin/main` via fresh clone + `git merge-base --is-ancestor`).

## Real scope of this exception — explicit boundary

**Only the currently real queued pull requests are covered by this exception.** This is not a general invitation to skip review on new, not-yet-reviewed real work. Every PR merged during this window must still be a real, already-fixed, already-`AUDIT: PASS`-reviewed item from the real backlog this exception exists to unblock — the custom `audit-check` CI job (validating a real, structured `AUDIT: PASS/FAIL` comment) remains a real, required, enforced status check throughout this entire window; only the *additional* native-GitHub-review layer is relaxed, not the substantive review mechanism itself.

## The real, explicit trigger condition to re-enable

**The moment `UMR-20260805-091629-d8e3` (the real second reviewer identity work) merges and the real second reviewer identity is live**, `required_approving_review_count` must be set back to `1` immediately. This is not open-ended. The re-enable action itself will be recorded in this same document (see below), not left for a future cycle to rediscover.

## Real re-enable record

**Status: NOT YET RE-ENABLED as of this document's own merge.** `UMR-20260805-091629-d8e3` has not yet merged. This section will be updated with the real timestamp, the real commit that re-enabled `required_approving_review_count: 1`, and independent confirmation, the moment that real work lands — not narrated in advance.

## Real citations

- `UMR-20260805-091648-6793` (this exception's own real Owner decision)
- `UMR-20260805-034917-33a9` (the real branch-protection hardening this temporarily relaxes)
- `UMR-20260805-091629-d8e3` (the real second-reviewer-identity work that must merge to trigger re-enable)
- PR #936 (first real PR merged under this exception, merge commit `118e1e8f89b7a72541963317b23e92cf0a966761`)
