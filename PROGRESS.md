# PROGRESS -- task-20260728-123646-fix-pr--617-real-audit-fail-reason

## Completed
- [x] Read PR #617 audit history via `gh api repos/FChecklist/compliance-tracker/issues/617/comments`
- [x] Identified real FAIL reason (2026-07-28T10:25:43Z audit): permits GET DTO renamed shipped `expiryDate` -> `endDate` with no backward-compat alias (breaking live contract per docs/API_CHANGELOG.md), and no API_CHANGELOG.md entry was added for this PR's new routes
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Found the exact right fix had already been pushed to the PR branch (commit 14d9aba9, 12:34:31Z, ~2min before this task started) -- restores `expiryDate` alongside `endDate` in toPermitDto + adds the docs/API_CHANGELOG.md entry. Verified both changes are correct and complete against the audit's own findings.
- [x] `bun install` (bun not on default PATH in this sandbox -- used `~/.bun/bin/bun`), then `tsc --noEmit` clean, `eslint` clean, `bun test` on the 3 relevant test files (14 pass/0 fail)
- [x] Ran `gh pr checks 617` -- caught a NEW real CI failure the prior push introduced: Terminology Guardrail Check failed on a literal `2026-07-28` ISO-date string inside the new back-compat-alias comment (hardcoded_iso_date pattern). Fixed by rewording the comment to not include a literal date (commit 12cd9771). Verified locally with `node scripts/check-terminology-guardrail.mjs --diff-only` -- passes.
- [x] Pushed fix to origin/feat/projexa-permits-drawings-moms (12cd9771)

## Remaining
- [ ] Wait for full CI run to go green on commit 12cd9771 (was mid-run as of last check: audit-check correctly still failing pending a fresh auditor comment, Vercel failing on known unrelated rate-limit, everything else pending/pass)
- [ ] Once CI (excluding Vercel/audit-check) is green, this PR needs a FRESH independent audit comment (AUDIT: PASS/FAIL) -- cannot self-certify per AGENTS.md Rule 10/7c since this session made the fix
- [ ] Update ai-os/boss/ACTIVE-CLAIMS.yaml claim with outcome once audit lands
- [ ] Do NOT merge -- per this task's own spec, tier2/FAIL stays open for review regardless of outcome; leave PR open for the owner/next auditor
