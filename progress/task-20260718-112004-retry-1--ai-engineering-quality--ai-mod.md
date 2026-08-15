# PROGRESS -- task-20260718-112004-retry-1--ai-engineering-quality--ai-mod

Task: VERIDIAN Review Framework gap-closure, AI Engineering Quality / AI-Modification
Readiness -- 2 findings:
1. [Low] Code Readability for AI -- comment discipline not enforced by tooling. Add a
   lightweight lint rule/CI check requiring a header comment on new service files.
2. [Medium] AI Modification Readiness -- no single readiness score; depends heavily on
   which file. Flag high-risk files (large + untested) explicitly in CLAUDE.md so agents
   apply extra caution there.

## Completed
- [x] Read AGENTS.md, CLAUDE.md, ai-os/CONSTITUTION.yaml pointers, and
      ai-os/boss/ACTIVE-CLAIMS.yaml -- no active claim overlaps this gap's scope
      (src/lib/services header-comment convention + CLAUDE.md high-risk-file callout).
      Registering this task's own claim next.
- [x] Discovered the shared root `PROGRESS.md` in this workspace belongs to a
      *different* concurrent task (cost-estimate 5-org analysis) -- an earlier
      invocation of this task had clobbered it with a fresh template. Reverted it via
      `git checkout -- PROGRESS.md` (restored the cost-estimate task's real content).
      Per this task's own instructions, this per-task file
      (`progress/task-20260718-112004-retry-1--ai-engineering-quality--ai-mod.md`) is
      the correct place to track progress, not the shared PROGRESS.md.
- [x] Verified finding 1 is NOT already resolved: `src/lib/services/*.ts` files
      widely follow a header-comment convention (Wave/gap-id + rationale, e.g.
      `access-review-service.ts`, `agent-review-service.ts`) but nothing in
      `scripts/*.mjs` or `.github/workflows/ci.yml` enforces it -- no existing script
      checks for header comments on service files.
- [x] Verified finding 2 is NOT already resolved: `grep -n -i "high-risk|readiness"
      CLAUDE.md AGENTS.md` returns nothing -- CLAUDE.md has no high-risk-file callout.

- [x] Wrote `scripts/check-service-header-comments.mjs`: fails if a file under
      `src/lib/services/*.ts` (a flat directory, excluding `*.test.ts` and pure
      re-export barrel `index.ts` files) has no leading `//`/`/**` header comment
      before the first statement. Wired into `.github/workflows/ci.yml` as a new
      `service-header-comment-check` job, matching the existing coverage-check
      pattern (check-doc-quarantine-banner.mjs et al.).
- [x] Ran it against the current repo: found exactly one real gap,
      `src/lib/services/context.ts` (comment existed but came *after* the leading
      import, unlike every other file in the directory). Fixed by adding a short
      header comment before the import, matching the established convention. Re-ran:
      passes clean, all 213 files.
- [x] Computed real large+untested file data across `src/**/*.ts(x)` (excluding
      `*.test.ts(x)`/`*.d.ts`): 1,806 non-test files, only 218 have a sibling test
      file. Added a `## High-Risk Files (Large + Untested)` section to CLAUDE.md:
      states the heuristic (500+ lines AND no sibling test file) so it's
      re-derivable and won't silently go stale, and names the current concrete
      standouts (`src/lib/db/schema.ts` 11.5k+ lines w/ migration-collision risk
      already covered by CI, `src/app/api/mcp/route.ts`,
      `src/lib/services/erp-accounting-service.ts` / `compliance-service.ts`,
      `src/lib/activity-log-service.ts`) with why each is risky, not just a bare
      file list.
- [x] Verified: `bun run lint` (0 errors, 3 pre-existing unrelated warnings),
      `NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit` (clean -- default
      heap OOMs on this repo's size regardless of this change, unrelated to this
      PR), `node scripts/check-service-header-comments.mjs` (passes).
- [x] Known environment limitation hit: this session's `gh`/git push token lacks
      the `workflow` OAuth scope, so `git push` unconditionally rejects any branch
      whose diff touches `.github/workflows/*.yml` ("refusing to allow an OAuth App
      to create or update workflow ... without `workflow` scope") -- confirmed by a
      failed push attempt, not assumed. Split the commit: pushed everything except
      the `.github/workflows/ci.yml` CI-wiring hunk (script + fix + CLAUDE.md +
      this file). The `ci.yml` diff (new `service-header-comment-check` job calling
      `node scripts/check-service-header-comments.mjs`, same shape as the existing
      `doc-quarantine-banner` job) is left as an uncommitted local working-tree
      change in this workspace, and pasted in full in the PR description for
      whoever has `workflow` scope (repo owner or a differently-scoped session) to
      apply as a one-line follow-up commit before/after merge. The check script
      itself is real and already fully wired to run manually
      (`node scripts/check-service-header-comments.mjs`) -- only the CI
      auto-enforcement step is blocked on this token limitation, not the
      substantive deliverable.

- [x] Opened PR #1254 (https://github.com/FChecklist/compliance-tracker/pull/1254),
      base `main`, head `worker/task-20260718-112004-retry-1--ai-engineering-quality--ai-mod`.
      Full `ci.yml` hunk pasted in the PR description per the split above. State at
      open: OPEN, MERGEABLE.

## Remaining
- [ ] Watch PR #1254's CI run to green, merge once green (this repo requires PR/CI,
      no direct push to `main` -- AGENTS.md Rule 6).
- [ ] Owner/differently-scoped session: apply the `.github/workflows/ci.yml` hunk
      (in this PR's description) so `service-header-comment-check` runs in CI --
      left as a documented follow-up, not blocking this PR's merge since the check
      script itself is a complete, real, independently-runnable deliverable.
- [ ] Move ACTIVE-CLAIMS entry to recently_completed once this PR merges.
