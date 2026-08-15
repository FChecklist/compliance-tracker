# PROGRESS -- task-20260718-112006-retry-1--ai-engineering-quality--code-s

VERIDIAN Review Framework gap-closure: AI Engineering Quality / Code Structure
& Modularity (5 findings). This is this task's OWN per-task progress file
(per the resume protocol) -- the shared root `PROGRESS.md` belongs to a
different, unrelated task (cost-estimate) and must not be overwritten; a
prior invocation of this task did overwrite it, that was reverted with
`git checkout -- PROGRESS.md` before any real work started this invocation.

Invocation 14/20 note: invocations 1-13 all failed at PRE-FLIGHT
(credit_accountant_rejected -- real OpenRouter balance below floor, no model
call ever made, no cost incurred). This is genuinely the first invocation to
do real work; not a repeat of a failed approach.

Branch was 1356 commits behind origin/main at the start of this invocation
(shared worktree checkout goes stale between real invocations) -- merged
`origin/main` clean (no conflicts) before starting.

## Completed
- [x] Read AGENTS.md/CLAUDE.md, merged origin/main (1356 commits, clean),
      read ai-os/boss/ACTIVE-CLAIMS.yaml in full before picking scope.
- [x] Re-verified all 5 findings against current source rather than trusting
      the original evaluation (per the task prompt's own instruction):
      - Code Modularity: CONFIRMED real. `schema.ts` is 11,543 lines/693KB
        (not the ~31 lines a shell-output-truncation artifact briefly
        suggested -- cross-checked with `git cat-file -s`).
        `task-execution-engine.ts` was 2,583 lines.
      - Component Reusability: CONFIRMED real. No REUSABLE-UTILITIES index
        existed anywhere in the repo.
      - Low Coupling/High Cohesion: CONFIRMED real. 323 `orgId` columns in
        schema.ts, zero have a Drizzle `.references()` FK constraint to
        `organisations`.
      - Design Pattern Consistency: CONFIRMED real. `eslint.config.mjs` has
        nearly every rule turned off; no requireAuth()-enforcing check
        exists. Found the exact precedent to follow:
        `scripts/check-route-error-handling.mjs` (from a sibling task,
        PR #1219) already does the equivalent for try/catch, using a
        repo-native CI-script pattern (not a literal ESLint AST rule) --
        that's the established enforcement class in this repo
        (check-guardrail-presence.mjs, check-migration-collision.mjs, etc.),
        so a new `check-route-requireauth.mjs` in the same shape is the
        right fit, not a bespoke ESLint plugin.
      - File & Folder Organization: PARTIALLY already resolved.
        `ai-os/OS.yaml`'s `what_should_exist_vs_what_does` section already
        documents the audit-tree (Tree 1) / system-tree (Tree 3) /
        tree4-unified (merge, "mostly archived into MASTER-TRACKER.yaml
        now") relationship -- this already IS the navigation aid the
        finding asks for on the ai-os/ side. Did not duplicate it. The
        `src/app/api/` side (138 top-level route groups, zero index/README)
        was still genuinely missing a navigation aid -- built that instead.
- [x] Collision-checked `ai-os/boss/ACTIVE-CLAIMS.yaml` before touching
      `schema.ts`/`task-execution-engine.ts`: dozens of active/recent
      entries touch `schema.ts` additively (new tables/columns) and several
      touch `task-execution-engine.ts`'s `dispatchEngine()` switch
      specifically (new engine-dispatch cases). A full mechanical split of
      either file, as the finding's recommended approach literally
      describes, would touch nearly every line of the single most-contended
      file in the repo and force every one of those in-flight sessions to
      rebase against a fully restructured file -- judged not safe to do
      live given current fleet conditions (this is the "codebase has moved
      since this evaluation was written" case the task prompt itself
      anticipates). See "Code Modularity" below for what was done instead.

### Code Modularity ([Medium], partially done, rest deliberately deferred+documented)
- [x] `task-execution-engine.ts`'s `dispatchTool()` was itself a single
      ~265-line if-chain covering 3 unrelated domains (compliance, GST
      reconciliation, construction) -- genuinely matches "distinct
      responsibilities" per the finding, and is NOT the actively-claimed
      part of the file (that's `dispatchEngine()`'s ~1,240-line switch,
      left untouched -- see above). Extracted into
      `src/lib/task-execution/{compliance,gst,construction}-tools.ts`,
      each exporting a `*_TOOL_CODES` Set + a `dispatch*Tool()` function.
      `dispatchTool()` is now a ~7-line router; same public signature, same
      behavior, zero call-site changes needed (verified via
      `grep -rln dispatchTool`). Added
      `src/lib/task-execution/tool-dispatch.test.ts` (routing-contract
      tests: CODES sets disjoint + cover the original code references,
      unknown-code error shape). `bunx tsc --noEmit` clean (0 errors,
      needed `NODE_OPTIONS=--max-old-space-size=6144` -- this repo's full
      typecheck OOMs at the default Node heap, a pre-existing scale issue
      unrelated to this change). All 7 new tests pass; existing
      `route.test.ts` suite covering `dispatchTool`'s callers still passes
      (12/12).
- [ ] Full `schema.ts` per-domain split: NOT done, deliberately. Real gap,
      but doing it now would collide with essentially every other
      concurrent session in the fleet (see collision-check note above).
      Left as documented, correctly-scoped future work rather than forced
      through -- a follow-up task with fleet-wide coordination (e.g. a
      declared freeze window on schema.ts edits) is the right way to do
      this, not one session's unilateral 11K-line rewrite.
- [ ] Full `dispatchEngine()` extraction (the ~1,240-line switch itself):
      same reasoning -- actively extended by other sessions right now.

### Component Reusability ([Low]) -- DONE
- [x] Added `docs/architecture/REUSABLE-UTILITIES.md`: a short index of the
      most-reused cross-cutting helpers (requireAuth/ServiceError,
      logger.ts, permission-service.ts, tenant-scoped.ts, audit.ts,
      llm-client.ts, guardrail-engine.ts, etc.), each with real usage-count
      evidence (`git grep -c`) rather than guessed, so it stays honest if
      it goes stale.

### Low Coupling / High Cohesion ([Medium]) -- DONE (incremental, as recommended)
- [x] Added real Postgres FK constraints (Drizzle `.references()`) for
      org-scoping on the highest-traffic tables, incrementally, per the
      finding's own recommended approach ("starting with org/user
      scoping") rather than all 323 at once. New migration generated via
      `bun run db:generate` (NOT pushed to the live DB from this session --
      see file/db-push note below).
- [ ] db:push to live Supabase: intentionally NOT run from this session.
      Generating the migration file is a reviewable PR change; applying it
      to the live production database is a hard-to-reverse, outward-facing
      action this task's authorization doesn't cover -- left for the normal
      deploy step/owner action, consistent with how this repo's other 314
      migrations were applied (no CI workflow runs db:push; it's not an
      automated step here).

### Design Pattern Consistency ([Low]) -- DONE
- [x] Added `scripts/check-route-requireauth.mjs`, same enforcement class/
      shape as the existing `check-route-error-handling.mjs` precedent
      (new/changed `route.ts` files only, not retroactive across the
      pre-existing ~995 files). Wired into `.github/workflows/ci.yml` as
      its own job.

### File & Folder Organization ([Medium]) -- DONE (API side; ai-os side already resolved)
- [x] `ai-os/` subtree navigation: already resolved by `ai-os/OS.yaml`
      (see re-verification note above) -- no duplicate doc added.
- [x] Added `src/app/api/README.md`: a navigation index grouping the ~138
      top-level API route directories by domain area, generated from a
      real directory listing (not hand-guessed).

## Remaining
- [ ] Fleet-coordinated follow-up for the full `schema.ts` / full
      `dispatchEngine()` split (see Code Modularity above) -- out of scope
      for a single session given current concurrent-edit density.
- [ ] Live `db:push` for the new FK-constraint migration -- owner/deploy
      action, not run from this session.
- [ ] Open PR, register+release ai-os/boss/ACTIVE-CLAIMS.yaml entry, get CI
      green, merge (Rule 6).
