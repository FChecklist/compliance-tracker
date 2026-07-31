# PROGRESS -- task-20260731-073931-deterministic-per-task-type-verification

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain; registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      (file scope: `scripts/verify-task-*.py`, `scripts/_verify_task_common.py`,
      one appended `KERNEL_CONSOLIDATION_STATUS.md` line -- no overlap with any other active claim).
- [x] Read `ai-os/scripts/postflight_audit_gate.py` and `STANDING_DIRECTIVE.yaml`'s
      `verification_command_predefinition_rule`: `--audit-cmd` must be copied verbatim from a
      task's own pre-defined `SUCCESS_CRITERIA`, never authored fresh at close time. This
      framework's scripts are meant to be exactly that kind of real, pre-definable command,
      reusable across many tasks of the same type.
- [x] Identified this session's 2 real, most-common task-type patterns from `gh pr list --state
      merged` + `gh pr view --json files` (not speculative):
      1. **sap-report** ("schema-additive migration + service function" / "SAP-report build") --
         by far the highest volume: PRs #636,637,638,642,644,645,646,648,651,654,658,629 all follow
         the identical real shape (service function + its own `*.test.ts`, new API route, often a
         new `drizzle/*.sql` migration + `drizzle/meta/_journal.json`, `ai-os/registry/
         terminology-guardrail-exemptions.yaml`).
      2. **rebase** ("rebase-only conflict resolution") -- confirmed via `git log --merges` +
         KERNEL_CONSOLIDATION_STATUS.md's own 2026-07-31 updates: PR #630 re-rebased twice, #653
         twice, #643/#652/#635/#610/#618/#604 dispatched as rebase-fix tasks, #656 fixing
         check-migration-collision.mjs's own stale-base-ref bug + a 4-migration renumber.
      Only 2 types built (not 3) -- did not find a real, distinct third recurring pattern this
      session; the prompt's third example ("SAP-report build") turned out to be the same real
      check-sequence shape as "schema-additive migration + service function", not a separate type.
- [x] Built `scripts/_verify_task_common.py` (shared helpers, genuinely reused by both scripts):
      resolves a PR number (merged or open) or a plain git ref/branch/sha to a real commit + diff
      base; checks it out into a **disposable `git worktree`** (never mutates this task's own
      checkout or collides with another session's in-flight worktree -- this repo is a shared
      multi-worktree checkout, confirmed via `git worktree list`); symlinks the caller's own
      `node_modules` in when `package.json`/`bun.lock` didn't change in the diff (the overwhelming
      majority of both task types) to avoid a multi-minute `bun install` per verification run,
      falling back to a real `bun install` when deps did change.
- [x] Built `scripts/verify-task-sap-report.py <pr_number|git_ref>`: `bunx tsc --noEmit` (always)
      + `bun test <changed *.test.ts files>` (always -- absence counted as a FAILED check, since
      this task type is defined by adding one) + `node scripts/check-migration-collision.mjs`
      (only if the diff touches `drizzle/*.sql`) + `node scripts/check-terminology-guardrail.mjs
      --diff-only` (always). Prints one JSON result, exits 0 only if every real check passed.
- [x] Built `scripts/verify-task-rebase.py <pr_number|git_ref>`: real conflict-marker scan
      (`git grep` for `^<{7} `/`^>{7} `/`^={7}$`, anchored so it doesn't false-positive on this
      repo's own long `# ====...====` markdown/yaml banner dividers) + `bunx tsc --noEmit` +
      `bun test` (only if the diff touches a `*.test.ts` file -- a pure conflict-resolution rebase
      legitimately may not) + migration-collision (conditional) + terminology-guardrail (always).
- [x] **Real environment finding, verified empirically, documented in both scripts' own
      docstrings**: this codebase's full-repo `bunx tsc --noEmit` genuinely OOMs on this session's
      current shared host -- not a code bug. Root-caused to two independent, stacked constraints:
      (a) V8's default old-space heap ceiling (~1GB) is well under what this large a program
      (hundreds of `schema.ts` tables) needs; (b) this task's own `systemd --user` unit has a real
      `MemoryHigh=2G`/`MemoryMax=3G` cgroup limit (added ~09:53 UTC today by a sibling
      infra task, see KERNEL_CONSOLIDATION_STATUS.md), and unrelated earlier `find`/`grep` scans
      over `/opt/veridian` in this same session had pushed this cgroup's kernel+file-cache usage to
      ~2.1GB (at the 2GB `memory.high` throttle) before tsc ever started. Fix applied: write to
      the unit's own `memory.reclaim` (a normal, permission-granted cgroup v2 knob, not a
      workaround of the limit itself) to force-reclaim stale cache before the check, plus
      `NODE_OPTIONS=--max-old-space-size=2560` so V8 actually uses the now-real ~2.9GB of
      headroom instead of self-limiting to ~1GB. Confirmed this combination avoids the OOM (a
      background timing run is in progress to confirm real wall-clock time before wiring it into
      the scripts as the default).

## Remaining
- [ ] Wire the confirmed memory.reclaim + NODE_OPTIONS fix into `scripts/_verify_task_common.py`'s
      typecheck check (currently plain `bunx tsc --noEmit`).
- [ ] Re-run `scripts/verify-task-sap-report.py 658` end-to-end (real merged PR) -- confirm exit 0.
- [ ] Demonstrate `scripts/verify-task-rebase.py` against a real merged rebase-type PR/commit.
- [ ] Demonstrate both scripts' negative case: a deliberately-broken temp branch (one intentionally
      failing test) -- confirm exit non-zero.
- [ ] Append one line to `/opt/veridian/ai-os/KERNEL_CONSOLIDATION_STATUS.md` (host-level file,
      outside this git repo, per this session's own convention for cross-task status) listing the
      2 task types covered and how each was demonstrated.
- [ ] Commit + push scripts; open PR per Rule 6 (no direct push to `main`).
- [ ] Do NOT post an AUDIT verdict on this own task's work (CONSTRAINTS).
