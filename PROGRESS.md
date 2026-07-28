# PROGRESS -- task-20260728-123646-fix-pr--617-real-audit-fail-reason

## Completed
- [x] Read PR #617 audit history via `gh api repos/FChecklist/compliance-tracker/issues/617/comments`
- [x] Identified real FAIL reason (2026-07-28T10:25:43Z audit): permits GET DTO renamed shipped `expiryDate` -> `endDate` with no backward-compat alias (breaking live contract per docs/API_CHANGELOG.md), and no API_CHANGELOG.md entry was added for this PR's new routes
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Found the exact right fix had already been pushed to the PR branch (commit 14d9aba9, 12:34:31Z, ~2min before this task started) -- restores `expiryDate` alongside `endDate` in toPermitDto + adds the docs/API_CHANGELOG.md entry. Verified both changes are correct and complete against the audit's own findings.
- [x] `bun install` (bun not on default PATH in this sandbox -- used `~/.bun/bin/bun`), then `tsc --noEmit` clean, `eslint` clean, `bun test` on the 3 relevant test files (14 pass/0 fail)
- [x] Ran `gh pr checks 617` -- caught a NEW real CI failure the prior push introduced: Terminology Guardrail Check failed on a literal `2026-07-28` ISO-date string inside the new back-compat-alias comment (hardcoded_iso_date pattern). Fixed by rewording the comment to not include a literal date (commit 12cd9771). Verified locally with `node scripts/check-terminology-guardrail.mjs --diff-only` -- passes.
- [x] Pushed fix to origin/feat/projexa-permits-drawings-moms (12cd9771)

- [x] Confirmed full CI is green on commit 12cd9771: Analyze, Asset Registry Coverage, Build, Doc Cross-Reference, Doc Quarantine Banner, Documentation Sentinel, E2E Tests, Guardrail Presence, Lint, Metadata Index Coverage, Secret Scanning, Security Pattern, Terminology Guardrail, Type Check, Unit Tests all PASS. Only 2 non-passing: Vercel (fails on a known unrelated `api-deployments-free-per-day` rate-limit, not a code issue) and `audit-check` (fails as expected -- `scripts/validate-audit-verdict.ts` correctly reports the most recent AUDIT comment is still the pre-fix 10:25:43Z FAIL verdict; there is no CI-triggerable "sweep" workflow in .github/workflows -- fresh audits are posted by a separate independent supervisor/auditor process outside this session's tool access)
- [x] Updated ai-os/boss/ACTIVE-CLAIMS.yaml claim with final outcome

## Remaining
- [ ] This session cannot post the required fresh AUDIT: PASS/FAIL comment itself (AGENTS.md Rule 7c/10: the agent that implements a fix cannot self-certify it) -- needs a separate/independent auditor session to re-review commit 12cd9771 and post a fresh verdict
- [ ] Do NOT merge -- per this task's own spec, tier2/FAIL stays open for review regardless of outcome; leave PR open for the owner/next auditor
