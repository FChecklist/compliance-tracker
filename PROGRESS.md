# PROGRESS -- rebase-sweep2-585 (replacement for PR #585)

## Scope

Replacement PR for #585 (`rca-task-20260726-172016-mother-...`, branch
`feat/mother-router-roster-persistent-memory`). Triage confirmed a real,
additive, well-evidenced gap: independently re-ran `grep -i
mother_router_memory` / `grep -i ai_agent_memory` against current main's
`src/lib/db/schema.ts` (774KB) -- zero matches, both. Independently confirmed
`src/app/api/ai/team/dispatch/route.ts` on current main still has no
`dispatchOutcomes`/`ai_agent_memory`/`recordMotherRouterOutcome` wiring --
`resolveMotherRouterModel()` there is only used for a fire-and-forget
audit-log call, no memory write. Checked the one plausibly-related table,
`platform.dispatchOutcomes` (does exist on main) -- its own schema comment
says it's written by `team-service.ts`'s `runRole()` /
`dispatch-repo.ts`'s `dispatchRepoTask()`, a different call path from
`mother-router.ts`'s `resolveModel()` / the roster-driven
`/api/ai/team/dispatch` endpoint this PR targets. Does not supersede this
PR's gap.

## Completed

- [x] Worktree: attempted a real `git merge origin/main` onto PR #585's
      actual branch first, per this repo's standard rebase-sweep protocol.
      The branch's own history turned out to be genuinely diverged from
      current main -- merge-base is `7d8c6f28`, dated 2026-07-26, with main
      1507 commits ahead of it vs. the branch's own 3. A literal merge
      produced 121 conflicted files (`AA`/`UU`/`UD`), the overwhelming
      majority in files this PR never touched (CRM/ERP/floor-plans/
      punch-list pages, etc.) and several of those were flagged `AA`
      (add/add) even though the blob was byte-identical between the
      merge-base and the PR branch tip -- a criss-cross/multi-merge-base
      artifact from this repo's heavy rebase/squash history, not a real
      content conflict. Aborted that merge. Instead, confirmed the PR's own
      real diff via local git (`git diff --name-status <merge-base>
      origin/feat/mother-router-roster-persistent-memory`): exactly 6 files
      -- `PROGRESS.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml`,
      `drizzle/0264_mother_router_roster_memory.sql` (new),
      `src/app/api/ai/team/dispatch/route.ts`, `src/lib/ai-router/mother-router.ts`,
      `src/lib/db/schema.ts`. Reset a fresh branch to `origin/main` and
      cherry-picked the PR's 3 real commits (`2adc22b8`, `645d80be`,
      `ec4d6216`) instead of merging the stale branch wholesale.
- [x] Resolved real conflicts:
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- append-only claims log; kept
        HEAD's content (everything main had accumulated since the
        merge-base, including the closed-out entry for the analogous
        #582->#1513 rebase-sweep) and appended this task's own claim entry
        from the PR's commit, unchanged.
      - `PROGRESS.md` (this file) -- replaced wholesale, this repo's own
        established convention (holds only the current active entry).
      - `src/lib/ai-router/mother-router.ts`, `src/lib/db/schema.ts` --
        see below.
- [x] `src/app/api/ai/team/dispatch/route.ts` merged automatically, no
      conflict -- untouched by main's independent changes since the
      merge-base at the same lines.

## Validation run

- [ ] `node scripts/check-governance-yaml-parse.mjs`
- [ ] `bunx tsc --noEmit` (or `node_modules/.bin/tsc.exe --noEmit`)
- [ ] `bun test` for touched test files
- [ ] Migration numbering check against the TRUE current highest
      (`git ls-tree -r origin/main -- drizzle/`), not a stale local
      checkout

## Remaining

- [ ] Finish resolving `src/lib/ai-router/mother-router.ts` /
      `src/lib/db/schema.ts` conflicts, verify migration number `0264` is
      still free on current main (renumber if collided).
- [ ] Run real validation (governance YAML parse, `tsc --noEmit`, `bun
      test`).
- [ ] Commit, push `rebase-sweep2-585`, open replacement PR citing #585.
- [ ] Close #585 as superseded with a comment linking the replacement.
- [ ] Check real CI on the replacement PR, merge only when genuinely green
      (modulo documented-ambient jobs).
