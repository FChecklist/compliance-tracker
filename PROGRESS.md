# PROGRESS -- task-20260728-123646-fix-pr--617-real-audit-fail-reason

## Completed
- [x] Read PR #617 audit history via `gh api repos/FChecklist/compliance-tracker/issues/617/comments`
- [x] Identified real FAIL reason (2026-07-28T10:25:43Z audit): permits GET DTO renamed shipped `expiryDate` -> `endDate` with no backward-compat alias (breaking live contract per docs/API_CHANGELOG.md), and no API_CHANGELOG.md entry was added for this PR's new routes
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml

## Remaining
- [ ] Checkout feat/projexa-permits-drawings-moms branch
- [ ] Fix permits route.ts toPermitDto to include both `endDate` and `expiryDate` (backward-compat alias)
- [ ] Add docs/API_CHANGELOG.md entry for this PR's routes + the permits field addition
- [ ] Run tsc/eslint/tests locally
- [ ] Commit + push to PR branch
- [ ] Re-adopt / trigger fresh audit sweep
- [ ] Confirm audit passes before considering done; do NOT merge if FAIL/tier2
