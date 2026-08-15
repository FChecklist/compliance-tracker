# PROGRESS -- task-20260718-111005-retry-0--ai-engineering-quality--ai-mod

VERIDIAN Review Framework gap-closure: AI Engineering Quality / AI-Modification Readiness (2 findings).

## Investigation (before writing code)

Both findings were re-verified against the current codebase rather than assumed still accurate, per the task instructions:

- **Code Readability for AI (Low)** — checked all 184 non-test files in `src/lib/services/`: 183/184 already carry a header comment explaining why the module exists (wave/gap-id provenance, design decisions). The convention is real and near-universal, but genuinely unenforced by any tooling — no CI job, lint rule, or script checks for it anywhere in `.github/workflows/` or `scripts/`. Gap confirmed as described, not already resolved.
- **AI Modification Readiness (Medium)** — confirmed no readiness-score mechanism exists anywhere in the repo, and confirmed via `wc -l` + test-file presence checks that several large business-logic files (schema, ERP money-handling services, auth-guard) genuinely have zero test coverage. Gap confirmed as described.

## Completed

- [x] Added `scripts/check-service-file-header-comment.mjs`: CI check that fails the build if a **new** file under `src/lib/services/*.ts` (added in the current branch relative to `main`, via `git merge-base`/`git diff --diff-filter=A` + untracked-file check — same pattern as the existing but dormant `check-migration-collision.mjs`) is missing a header comment. Only checks new files, so it never fails retroactively on the 183/184 already-compliant existing files. Verified locally: fails on a file with no leading comment, passes once one is added, passes clean on the current branch (zero new service files).
- [x] Added a "High-Risk Files (large + untested)" section to `CLAUDE.md`, listing the largest business-logic files with zero test coverage (`src/lib/db/schema.ts` ~10,200 lines, several ERP money-handling services, `auth-guard.ts`, `compliance-service.ts`, `activity-log-service.ts`), computed from real `wc -l` + test-file-presence data on 2026-08-15, with an explicit caveat that the list is a point-in-time heuristic (not live-scored) and instructions for agents to re-verify before trusting it as current, plus extra-caution guidance (read the whole file, smallest coherent change, prefer adding a test). Explicitly excluded `src/lib/services/permission-service.ts` from the list (it already has a test file) and noted its `ERP_ACTION_ROLES` table should only be extended additively, per this task's own scope instruction not to touch that shared structure.

## Remaining

- [ ] **Blocked, not skipped:** wiring `scripts/check-service-file-header-comment.mjs` into `.github/workflows/ci.yml` — the script itself is written, tested locally (fails on a headerless file, passes once one is added), and ready; the one-line CI job addition could not be pushed because this session's `gh` token lacks the `workflow` OAuth scope (confirmed via a rejected `git push`, not assumed — GitHub requires that scope for any push touching `.github/workflows/*.yml`). The exact job YAML to add, plus verification steps, is recorded as **FOLLOWUPS.md FOLLOWUP-3** for a session/owner with `workflow` scope to apply in a one-line follow-up push. Without this, the "Low" finding's CI-enforcement half is incomplete — see FOLLOWUP-3 before marking this finding fully closed.
