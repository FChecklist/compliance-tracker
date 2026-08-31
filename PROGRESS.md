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
        exactly the PR's intended 2-function/2-field addition (+86/-2,
        matching the original PR's own diff stat exactly), nothing dropped
        or duplicated.
      - `src/lib/db/schema.ts` -- git flagged this as ONE conflict
        spanning virtually the entire 774KB/12.8k-line file (criss-cross
        artifact, same cause as above), not a real content conflict at any
        specific line. Resolved by taking `origin/main`'s version of the
        file whole (`git checkout --ours`) and manually re-inserting the
        PR's own real, isolated 58-line addition (`git diff <merge-base>
        645d80be -- src/lib/db/schema.ts`) at its correct location (right
        after the `aiRoutingAuditLog` table, before the Task Register
        section) -- both new enums + both new tables, byte-for-byte as
        authored. Independently verified the result against `origin/main`
        via Python's `difflib.SequenceMatcher(autojunk=False)` (git's own
        diff view is a poor cosmetic match on this file -- see the CRLF
        note below): exactly one real change, a clean 58-line insert at
        line 12239, nothing else touched.
- [x] `src/app/api/ai/team/dispatch/route.ts` merged automatically (both
      git's 3-way merge and, for one later hunk, `git cherry-pick`'s own
      resolution correctly hoisted `estimateCostUsd(...)` into a shared
      `dispatchCostUsd` local now reused by both the pre-existing
      `activity_log` write and this PR's new `mother_router_memory`
      outcome write) -- no manual conflict resolution needed, diffed
      against `origin/main` afterward to confirm correctness (+63/-8,
      matching the original PR's own diff stat exactly).
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
      drizzle/` (0504, 332 real `.sql` files -- `ls`/`find` globs on this
      Windows shell undercounted, 302 and 51 respectively on two different
      attempts; `git ls-tree` is the reliable source), not a stale local
      checkout, and renumbered to 0505 (confirmed free). `git mv`'d the
      file, added the corresponding `drizzle/meta/_journal.json` entry
      (`idx: 327`, `tag: 0505_mother_router_roster_memory`), and confirmed
      no other file in the repo referenced the old `0264_...` filename
      before or after the rename. The migration's own internal comments
      cite `drizzle/0231` (`ai_routing_audit_log`) and `drizzle/0249`
      (`task_register`) for context -- both unrelated, both still accurate
      on current main, left unchanged. Noted, not fixed (pre-existing,
      unrelated to this PR): `origin/main` already has a 5-file gap between
      real `.sql` files (332) and journal entries (327) before this branch
      touches anything; this branch's own file+journal-entry pair keeps
      that same gap at 5, not widening it.
- [x] **CRLF line-ending contamination, found and fixed.** This worktree's
      checkout picked up `core.autocrlf=true` from the machine's system
      gitconfig (`C:/Program Files/Git/etc/gitconfig`) despite the parent
      clone's own `C:/ct/ct/.git/config` overriding it to `false` -- cause
      not fully root-caused (worktree config inheritance is normally
      shared, not per-worktree, so this may be a transient checkout-time
      quirk rather than a real config gap), but the effect was real: the
      working-tree copies of `schema.ts`, `mother-router.ts`,
      `dispatch/route.ts`, and `ai-os/boss/ACTIVE-CLAIMS.yaml` all ended up
      CRLF at various points while every other file in the repo (and
      `origin/main`'s own committed blobs) stayed LF. This is exactly the
      class of drift `.gitattributes`' own `E102_MIGRATION_LEDGER_LINE_ENDING_HASH_SPLIT`
      comment warns about for `drizzle/*.sql` -- not itself a `.sql` file
      here, but the same failure mode, and it was also inflating `git
      diff`'s own output into apparent full-file rewrites (tens of
      thousands of +/- lines for what were real few-line changes),
      confusing verification. Caught via a byte-level CRLF/LF count on
      every touched file against `origin/main`'s own committed line
      endings, fixed by normalizing all 4 files back to LF with a
      binary-mode (not text-mode -- Python's text-mode `open(..., 'w')`
      round-trips through the platform's own newline convention and was
      the proximate cause of at least one of these conversions) read/write,
      then re-verified byte-for-byte correctness and clean diff stats
      against `origin/main` for every file afterward.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml`: also had a real, independent
        indentation bug in the new claim entry the PR's own commit added
        (0-space list-item indent; this file's actual convention,
        confirmed against every neighboring entry, is 2-space), which is
        what `check-governance-yaml-parse.mjs` (below) caught for real --
        fixed by re-indenting exactly that entry's lines, nothing else.

## Validation run

- [x] `node scripts/check-governance-yaml-parse.mjs` -- FAILED on first run
      (the real `ai-os/boss/ACTIVE-CLAIMS.yaml` indentation bug above),
      PASSED after the fix: all 5 governance YAML files parse cleanly.
- [x] `node_modules/.bin/tsc.exe --noEmit`
      (`NODE_OPTIONS=--max-old-space-size=6144`, this repo's documented
      Windows fallback) -- first run showed 4 `Cannot find module` errors
      (`@axe-core/playwright`, `@huggingface/transformers` x2,
      `@mlc-ai/web-llm`), none in a file this PR touches; root-caused to
      this worktree's first `bun install` not having fully installed those
      3 declared (non-optional) `package.json` dependencies (confirmed
      present in the separate `C:/ct/ct` reference checkout's own
      `node_modules`, absent here) -- a second `bun install` in this
      worktree installed all 3 (125 packages), and the re-run passed with
      **zero errors**.
- [x] `bun test src/lib/ai-router/mother-router.test.ts` (the one existing
      test file covering a source file this PR modifies -- this PR itself
      adds no new test file) -- **30 pass, 0 fail, 72 expect() calls**.
- [x] `node scripts/check-migration-integrity.mjs` /
      `check-migration-schema-drift.mjs` -- both ran (DB-comparison leg
      skipped, no `DATABASE_URL` set locally, as documented in each
      script's own header); 328 journal entries confirmed present on this
      branch (327 on `origin/main` + this PR's 1).
      `check-migration-collision.mjs --base origin/main` hit the
      documented Windows-only `execSync`/`2>/dev/null` parsing artifact
      (real CI runs on `ubuntu-latest`, unaffected) -- replicated its real
      logic by hand via `git ls-tree -r origin/main -- drizzle/` instead
      (see the renumbering entry above).

## Remaining

- [ ] Push `rebase-sweep2-585`, open replacement PR citing #585.
- [ ] Close #585 as superseded with a comment linking the replacement.
- [ ] Check real CI on the replacement PR, merge only when genuinely green
      (modulo documented-ambient jobs: E2E, Vercel platform-block, Secret
      Scanning on pre-existing files, Promptfoo Evals timeout).
