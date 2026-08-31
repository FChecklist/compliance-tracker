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
      punch-list pages, etc.), and several of those were flagged `AA`
      (add/add) even though the blob was byte-identical between the
      merge-base and the PR branch tip -- a criss-cross/multi-merge-base
      artifact from this repo's heavy rebase/squash history, not a real
      content conflict. Aborted that merge. Instead, confirmed the PR's own
      real diff via local git (`git diff --name-status <merge-base>
      origin/feat/mother-router-roster-persistent-memory`): exactly 6 files
      -- `PROGRESS.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml`,
      `drizzle/0264_mother_router_roster_memory.sql` (new),
      `src/app/api/ai/team/dispatch/route.ts`,
      `src/lib/ai-router/mother-router.ts`, `src/lib/db/schema.ts`. Reset a
      fresh branch to `origin/main` and cherry-picked the PR's 3 real
      commits (`2adc22b8`, `645d80be`, `ec4d6216`) instead of merging the
      stale branch wholesale.
- [x] Resolved real conflicts:
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- append-only claims log; kept
        HEAD's content (everything main had accumulated since the
        merge-base, including the closed-out entry for the analogous
        #582->#1513 rebase-sweep) and appended this task's own claim entry
        from the PR's commit, unchanged.
      - `PROGRESS.md` (this file) -- replaced wholesale, this repo's own
        established convention (holds only the current active entry).
      - `src/lib/ai-router/mother-router.ts` -- two small real hunks: (1)
        import line -- kept main's own `sql` import (genuinely used at
        line ~626, added independently since the merge-base) alongside the
        PR's own `motherRouterMemory`/`createId` additions; (2)
        `MotherRouterResolution` type -- kept main's own `resolvedConfig`
        field (an unrelated, independently-added end_user_org/gateway
        feature) alongside the PR's own `dispatchId` field. Diffed the
        result against `origin/main` afterward to confirm the change is
        exactly the PR's intended 2-function/2-field addition, nothing
        dropped or duplicated.
      - `src/lib/db/schema.ts` -- git flagged this as ONE conflict
        spanning virtually the entire 774KB/12.8k-line file (criss-cross
        artifact, same cause as above), not a real content conflict at any
        specific line. Resolved by taking `origin/main`'s version of the
        file whole (`git checkout --ours`) and manually re-inserting the
        PR's own real, isolated 58-line addition (`git diff <merge-base>
        645d80be -- src/lib/db/schema.ts`) at its correct location (right
        after the `aiRoutingAuditLog` table, before the Task Register
        section) -- both new enums + both new tables, byte-for-byte as
        authored, confirmed present exactly once afterward.
- [x] `src/app/api/ai/team/dispatch/route.ts` merged automatically (both
      git's 3-way merge and, for one later hunk, `git cherry-pick`'s own
      resolution correctly hoisted `estimateCostUsd(...)` into a shared
      `dispatchCostUsd` local now reused by both the pre-existing
      `activity_log` write and this PR's new `mother_router_memory`
      outcome write) -- no manual conflict resolution needed, diffed
      against `origin/main` afterward to confirm correctness.
- [x] Cherry-pick sequencer hygiene: an earlier `git cherry-pick --no-commit
      <3 commits>` attempt (superseded by the per-commit approach above)
      left a stale `.git/.../sequencer/todo` behind after its first
      conflict was resolved with a plain `git commit` instead of
      `--continue`. This caused one later `--continue` to silently replay
      an already-committed pick a second time and conflict against itself.
      Caught it (the second "Add ground-up persistent memory..." conflict
      immediately following its own successful commit was the tell),
      manually removed the stale `sequencer`/`CHERRY_PICK_HEAD` state (not
      `--abort`, which would have targeted the sequence's original
      pre-cherry-pick HEAD and risked discarding both already-good
      commits), `git reset --hard HEAD` back to the last known-good commit,
      and re-verified `git log`/`git status`/a full diff against
      `origin/main` were clean before proceeding.
- [x] **Migration renumbering: 0264 -> 0505.** `drizzle/0264_...` was
      already taken on current main by an unrelated, already-merged
      migration (`0264_helpdesk_tiered_sla_team_routing.sql`) -- same class
      of collision as the precedent `#582->#1513` rebase-sweep documented
      elsewhere in this file's own history and in `ACTIVE-CLAIMS.yaml`.
      Checked the TRUE current highest via `git ls-tree -r origin/main --
      drizzle/` (0504, 328 real migration files), not a stale local
      checkout, and renumbered to 0505 (confirmed free). `git mv`'d the
      file, added the corresponding `drizzle/meta/_journal.json` entry
      (`idx: 327`, `tag: 0505_mother_router_roster_memory`), and confirmed
      no other file in the repo referenced the old `0264_...` filename
      before or after the rename. The migration's own internal comments
      cite `drizzle/0231` (`ai_routing_audit_log`) and `drizzle/0249`
      (`task_register`) for context -- both unrelated, both still accurate
      on current main, left unchanged.

## Validation run

- [ ] `node scripts/check-governance-yaml-parse.mjs`
- [ ] `bunx tsc --noEmit` (or `node_modules/.bin/tsc.exe --noEmit`)
- [ ] `bun test` for touched test files
- [ ] Migration collision/integrity checks

## Remaining

- [ ] Run real validation (governance YAML parse, `tsc --noEmit`, `bun
      test`, migration checks).
- [ ] Commit the renumbering, push `rebase-sweep2-585`, open replacement PR
      citing #585.
- [ ] Close #585 as superseded with a comment linking the replacement.
- [ ] Check real CI on the replacement PR, merge only when genuinely green
      (modulo documented-ambient jobs: E2E, Vercel platform-block, Secret
      Scanning on pre-existing files, Promptfoo Evals timeout).
