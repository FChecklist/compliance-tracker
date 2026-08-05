# PROGRESS -- task-20260805-164944-restore-required-approving-review-count

## Completed
- [x] Registered ACTIVE-CLAIMS entry before starting work (commit d2026669)
- [x] Independently verified PR #938 (identity-guard check, `UMR-20260805-091629-d8e3`) is genuinely merged (2026-08-05T09:37:27Z)
- [x] Independently verified `required_approving_review_count` was still `0` on `compliance-tracker` `main` (the promised re-enable had not been executed)
- [x] Independently verified the governance doc's OTHER re-enable condition ("the real second reviewer identity is live") is NOT met: `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md` (same PR #938) explicitly says no second GitHub identity was provisioned; `gh auth status` / `orgs/FChecklist/members` / zero reviews on last 7 merged PRs all corroborate this independently
- [x] Restored `required_approving_review_count` to `1` via `gh api --method PUT .../branches/main/protection` at 2026-08-05T16:52:34Z, all other protection fields (enforce_admins, all 8 required status checks, etc.) preserved unchanged and re-verified after the call
- [x] Updated `ai-os/GOVERNANCE_RECORD_TEMPORARY_REVIEW_COUNT_EXCEPTION_2026-08-05.md`'s "Real re-enable record" honestly: recorded the real timestamp/action, cited PR #938 as the trigger per the PM decision, AND flagged that the identity-live half of the original trigger condition is not actually satisfied, so this restore will likely block all future PR merges (self-approval impossible, enforce_admins on, no second identity) until the Owner provisions the GitHub App per that same gap doc's recommendation
- [x] Committed + pushed each meaningful unit (claim registration, then the governance-doc update)

## Remaining
- [ ] None for this task. Follow-on (not in scope here, flagged for the Owner): provision the second-reviewer GitHub App per `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md` so future PRs can actually satisfy `required_approving_review_count: 1`.
