# PROGRESS -- task-20260805-164944-restore-required-approving-review-count

## Completed
- [x] Registered ACTIVE-CLAIMS entry before starting work (commit d2026669)
- [x] Independently verified PR #938 (identity-guard check, `UMR-20260805-091629-d8e3`) is genuinely merged (2026-08-05T09:37:27Z)
- [x] Independently verified `required_approving_review_count` was still `0` on `compliance-tracker` `main` (the promised re-enable had not been executed)
- [x] Independently verified the governance doc's OTHER re-enable condition ("the real second reviewer identity is live") is NOT met: `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md` (same PR #938) explicitly says no second GitHub identity was provisioned; `gh auth status` / `orgs/FChecklist/members` / zero reviews on last 7 merged PRs all corroborate this independently
- [x] Restored `required_approving_review_count` to `1` via `gh api --method PUT .../branches/main/protection` at 2026-08-05T16:52:34Z, all other protection fields (enforce_admins, all 8 required status checks, etc.) preserved unchanged and re-verified after the call
- [x] Updated `ai-os/GOVERNANCE_RECORD_TEMPORARY_REVIEW_COUNT_EXCEPTION_2026-08-05.md`'s "Real re-enable record" honestly: recorded the real timestamp/action, cited PR #938 as the trigger per the PM decision, AND flagged that the identity-live half of the original trigger condition is not actually satisfied, so this restore will likely block all future PR merges (self-approval impossible, enforce_admins on, no second identity) until the Owner provisions the GitHub App per that same gap doc's recommendation
- [x] Committed + pushed each meaningful unit (claim registration, then the governance-doc update)

- [x] Opened PR #963 with this task's own doc changes (claim registration commit d2026669 was already on main via the direct-push worker branch merge path used elsewhere in this session's history; PR #963 carries the governance-doc + PROGRESS.md update)
- [x] Confirmed the flagged consequence is already real, not hypothetical: PR #963 itself came back `mergeStateStatus: BLOCKED` / `reviewDecision: REVIEW_REQUIRED` immediately after opening — this task's own PR cannot self-approve past the setting it just restored

## Remaining
- [ ] None left for this task's scope (the branch-protection restore + honest governance record are both done and verified). Real, currently-live blocker for the Owner: PR #963 (this task's own doc PR) is stuck exactly as predicted — no path to merge until either the GitHub App from `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md` is provisioned, or the Owner reviews it via a separate GitHub identity, or another bounded exception is granted.
