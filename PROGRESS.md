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
- [x] `git merge origin/main` (round 1) -- 7 conflicts: `PROGRESS.md` (single-current-entry
      convention, replaced wholesale), `ai-os/boss/ACTIVE-CLAIMS.yaml` (main had independently
      pruned its `active:` list ~6700->~560 lines, a legitimate rolling cleanup per the file's
      own protocol #3 -- re-appended this task's own claim entry on top rather than dropping
      it), `src/app/api/projects/route.ts` + `src/lib/services/product-service.ts` (real logic
      conflict: this PR's `dbUser`-based `canReadProject()` gate vs main's own concurrent R48/
      F002 `scopeToLead` lead-only narrowing for manager/senior_professional ranks -- merged
      both into one `listAllProjectsForOrg()`), `src/lib/db/schema.ts` (purely additive, kept
      both this PR's 4 new columns and main's independent `projectValue`), `src/lib/services/
      pms-issue-service.ts` + its test file (purely additive, kept both this PR's
      rollupPercentage write-back and main's independent per-issue completionPercentage
      read-time rollup).
- [x] Real migration-number collision found: this PR's `0302_pms_project_status_access_rollup.sql`
      collided with main's own real `0302_sales_pipeline_dashboard_targets.sql` (journal idx
      279 -- `drizzle/meta/_journal.json` is fully current on main now, NOT stale as earlier
      sessions found it). Renamed to `drizzle/0512_pms_project_status_access_rollup.sql` (above
      main's true highest, 0511, confirmed via `git ls-tree -r origin/main -- drizzle/`) with a
      matching new `_journal.json` entry (idx 334).
- [x] Re-ran `bun install` after round-1 merge -- package.json/bun.lock changed by the
      main-merge; caused a transient false-positive `@axe-core/playwright` type-check failure
      until reinstalled (matches this repo's own documented gotcha).
- [x] Validated (round 1): `node scripts/check-governance-yaml-parse.mjs` (pass, 5/5),
      `NODE_OPTIONS=--max-old-space-size=8192 bunx tsc --noEmit` (clean, 0 errors),
      `bun test src/lib/services/pms-issue-service.test.ts src/lib/services/product-service.test.ts`
      (24 pass / 0 fail). Full `bun test`: 3556 pass / 15 fail / 5 skip -- all 15 failures
      independently re-confirmed pre-existing on a clean origin/main baseline (same full-suite
      run, zero PR #664 changes, separate throwaway worktree) -- a full-suite test-isolation
      flake (translatePromptVersion, projexa/accounts, ar-aging, dunning-list,
      finance-dashboard role-gate tests), unrelated to this PR.
- [x] Pushed `rebase-sweep2b-664`, opened PR #1527 ("... [was #664]"), closed #664 with a
      comment pointing to #1527.
- [x] `git merge origin/main` (round 2) -- main advanced again within minutes (PR #663's
      project-team-junction-table + PR #92/#93's CSP/X-Frame-Options both landed) before CI
      could register on #1527, flipping mergeable to CONFLICTING. 3 conflicts this round:
      `PROGRESS.md` (same wholesale-replace convention), `drizzle/meta/_journal.json` (both
      sides appended new entries at the tail -- kept both, renumbered idx sequentially),
      `src/lib/services/product-service.test.ts` (add/add -- both sides added a new test file
      at the same path for different reasons; merged both real test suites into one file).
      `ai-os/boss/ACTIVE-CLAIMS.yaml` and `src/lib/db/schema.ts`/`product-service.ts` merged
      clean automatically this round (no new conflicts on top of round 1's resolution).

## Remaining
- [ ] Re-validate after round-2 merge: tsc --noEmit, targeted + full `bun test`.
- [ ] Push round-2 merge immediately, then re-check CI/mergeable state right away before main
      can advance again (per this repo's own documented pattern for fast-moving concurrent
      rebase-sweeps).
- [ ] Verify real CI on PR #1527 (`gh pr checks 1527`) -- retry on transient network errors up
      to 5 times; ignore known-ambient failures (E2E Tests, Vercel, Secret Scanning on
      pre-existing files, Promptfoo Evals).
- [ ] Merge PR #1527 only when genuinely green (modulo the known-ambient ones).
