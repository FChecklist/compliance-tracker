# PROGRESS -- task-20260729-001510-fix-pr--617-real-audit-fail-reason

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml -- no other active claim on PR #617 / permits-drawings-moms branch
- [x] Read PR #617's full audit history (6 issue comments). Last audit (2026-07-28T10:25:43Z) was AUDIT: FAIL with two real, blocking findings:
      1. `GET /api/v1/projexa/permits` DTO silently renamed the already-shipped `expiryDate` field to `endDate` with no back-compat alias -- a breaking change to a documented-stable external contract PROJEXA depends on.
      2. No `docs/API_CHANGELOG.md` entry added for this PR's new routes / the permits rename, despite that file's own same-PR convention.
      (A third, explicitly low-severity/non-blocking finding -- POST routes not verifying caller-org ownership of a supplied projectId -- matches pre-existing codebase convention and was correctly left alone.)
- [x] Confirmed both real findings were already fixed on the branch by prior commits `14d9aba9` (restore expiryDate alias + add changelog entry) and `12cd9771` (terminology-guardrail fix for a literal ISO date in a code comment) -- present on `origin/feat/projexa-permits-drawings-moms`, not yet re-audited.
- [x] Independently verified the fix in a fresh worktree (`/tmp/pr617-audit` @ 12cd9771), not just trusted the commit messages:
      - `toPermitDto` now returns both `endDate` and `expiryDate: doc.expiryDate` (same value)
      - `docs/API_CHANGELOG.md` has a real 2026-07-28 entry covering every new route + the field-rename decision
      - `NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit` clean
      - `bun test` on both new test files: 7/7 pass
      - `bunx eslint` on all 6 core changed files: clean
      - `gh pr checks 617`: all required jobs pass on this head commit (Type Check, Lint, Unit Tests, Build, E2E, Analyze, Guardrail Presence, Metadata Index Coverage, Terminology Guardrail, Doc Cross-Reference, Security Pattern, Secret Scanning, Doc Quarantine Banner, Documentation Sentinel, Asset Registry Coverage). Only non-passing check: Vercel preview deploy, failing on an unrelated free-tier daily-deployment rate limit, not this PR's code.
- [x] Posted a fresh, independent structured `AUDIT: PASS` comment on PR #617 (as required auditor per AGENTS.md Rule 7c/10 -- this session did not author the fix commits) covering the 8 required fields.
- [x] Re-triggered the `audit-check` CI job (`gh run rerun`) so `mandatory-audit-check.yml` picks up the new PASS verdict instead of the stale FAIL.

- [x] Confirmed re-run `audit-check` job passed and `mergeStateStatus` cleared from BLOCKED to UNSTABLE (only the unrelated Vercel free-tier rate-limit deployment check was non-green, which is not a required merge check).
- [x] Merged PR #617 into `main` via `gh pr merge --merge` (merge commit `c9cea46b`, matching this repo's established merge-commit convention for merged PRs).
- [x] Cleaned up the temporary verification worktree at `/tmp/pr617-audit`.

## Remaining
- [ ] None -- task complete. PR #617 merged with a real, independently-verified fix for the actual audit-FAIL root cause (breaking `expiryDate`->`endDate` rename + missing changelog entry), not a workaround.
