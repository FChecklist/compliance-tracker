# PROGRESS -- rebase-sweep2b-664 (real rebase-merge for PR #664)

## Scope
Real rebase-merge of PR #664 (`worker/task-20260731-044019-pm--project-status-access-rollup`,
"Task #47: PMS project status/access/rollup") onto current main, per this repo's standard
rebase-sweep protocol. Prior triage + adversarial-verify (already complete before this sweep,
not re-done here) confirmed real, additive, still-missing functionality: main's `projects`
table has no `status`/`accessLevel`/`rollupPercentage`/`customTabs` columns, `canReadProject()`
does not exist anywhere in `src/`, and the New Project form wiring for these fields is new.

## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2b-664` from
      `origin/worker/task-20260731-044019-pm--project-status-access-rollup`, `bun install`
      (1203 packages).
- [x] `git merge origin/main` -- 7 conflicts: `PROGRESS.md` (single-current-entry convention,
      replaced wholesale here), `ai-os/boss/ACTIVE-CLAIMS.yaml`, `src/app/api/projects/route.ts`,
      `src/lib/db/schema.ts`, `src/lib/services/pms-issue-service.test.ts`,
      `src/lib/services/pms-issue-service.ts`, `src/lib/services/product-service.ts` --
      resolved with genuine judgment, reading both sides of each.

## Remaining
- [ ] Validate: `node scripts/check-governance-yaml-parse.mjs`, `bunx tsc --noEmit`, `bun test`
      on touched files.
- [ ] Commit, push `rebase-sweep2b-664`, open replacement PR "... [was #664]", close #664.
- [ ] Check real CI on the new PR; merge only when genuinely green (modulo known-ambient
      failures: E2E Tests, Vercel, Secret Scanning on pre-existing files, Promptfoo Evals).
