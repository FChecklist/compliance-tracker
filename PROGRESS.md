# PROGRESS -- task-20260731-073927-enable-github-merge-queue-on-compliance

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no collision with other active sessions
- [x] Captured real current branch protection via `gh api repos/FChecklist/compliance-tracker/branches/main/protection` -- 7 required status checks: Lint, Type Check, Build, audit-check, Guardrail Presence Check, Asset Registry Coverage Check, Unit Tests. `enforce_admins: true`, `required_approving_review_count: 0`. `rules/branches/main` and `rulesets` both returned `[]` -- no ruleset exists yet, protection is classic-API only.
- [x] Attempted to create a repository ruleset with `pull_request` + `required_status_checks` (mirroring current classic protection) + `merge_queue` (squash, ALLGREEN, min/max group size 1/5) rules -- rejected `422 Invalid rule 'merge_queue'` with no detail message.
- [x] Verified the `merge_queue` parameters against GitHub's own published OpenAPI schema (`repository-rule-merge-queue` component) -- payload matched exactly; ruled out a schema/formatting mistake.
- [x] Tested prerequisite theories: enabled `allow_auto_merge` (was `false`) and retried in isolation (ruleset with enforcement disabled, merge_queue rule only) -- still rejected identically.
- [x] Root-caused via GitHub's own docs/changelog (fetched live): merge queue is only available for repositories owned by a GitHub **Organization** (public repos on any plan, private repos on Team/Enterprise Cloud) -- it does not exist for personal **User**-account repos at all. Confirmed `gh api repos/FChecklist/compliance-tracker --jq '.owner.type'` = `"User"`. This is a hard platform restriction, not a fixable request.
- [x] Reverted the exploratory `allow_auto_merge` change back to `false` (its original value) -- confirmed via API.
- [x] Re-verified repo state is byte-identical to pre-task: `rulesets` still `[]`, required-status-check contexts list unchanged, `allow_auto_merge` back to `false`.
- [x] Appended a dated update to `/opt/veridian/ai-os/KERNEL_CONSOLIDATION_STATUS.md` documenting the blocker, the before/after required-checks diff (no change), and a recommendation (transfer repo to an Organization if merge queue is wanted). Committed locally in that repo (`4d06498`); not pushed (shared live control-plane repo with many unrelated in-flight dirty files from other concurrent processes -- pushing was judged out of scope/risky for this task).

- [x] Pushed branch and opened PR #670 (https://github.com/FChecklist/compliance-tracker/pull/670) so this doc-only conclusion goes through the standard PR/CI gate (Rule 6) instead of sitting as an unpushed local commit.

## Remaining
- [ ] Merge PR #670 once CI is green (doc-only change, no application code touched).
- [ ] Nothing further actionable by this task beyond that. Blocked on an Owner decision: transfer `FChecklist/compliance-tracker` to a GitHub Organization (the only real way to unlock merge queue), or accept current PR/CI + rebase-on-conflict as the standing mitigation for migration-number collisions.

## Outcome: BLOCKED (platform limitation, not a config error)
GitHub's merge queue cannot be enabled on `FChecklist/compliance-tracker` because it is owned by a personal GitHub User account, not an Organization. No repository setting was changed as a result of this task (the one exploratory toggle made mid-investigation was reverted). All 7 previously-required status checks remain required, unchanged.
