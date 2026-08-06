# PROGRESS -- task-20260806-151801-root-cause-and-fix-real-dispatch-queue-s

## Completed
- [x] Investigated SPEC's premise (real dispatch-queue starvation: 30 tier-1 `queued` rows
      permanently ahead of new tier-1 dispatches, stuck via `check-duplicate battery call
      failed` retry loop in `directive_engine.py`/`resource_governor.py`, live at
      `/opt/veridian/scripts`, repo `FChecklist/veridian-scripts` -- confirmed via
      [[veridian-scripts-separate-repo-live-checkout]]).
- [x] Found this exact bug already root-caused and fixed: **PR #153**
      (`fix/dispatch-queue-starvation-umr20260806090229-f2a7`, UMR-20260806-090229-f2a7,
      parent UMR-20260806-071025-1d28), **MERGED 2026-08-06T09:46:48Z** -- over 5 hours
      before this task's own dispatch (task workspace timestamped 15:18:01 same day).
      Merge commit `2782998` is on `main` in the live checkout, confirmed present:
      `resource_governor.py` has `MAX_QUEUED_AGE_SECONDS` (line 97) and
      `flag_stale_queued_tasks()` (line 1410, wired into `run_tick()` line 1515);
      `directive_engine.py` has the durable retry-gate fix (comments at lines 26, 41-42,
      92, 276, 320 citing UMR-20260806-090229-f2a7 rounds 1 and 2, the second round fixing
      an independent Superboss review finding on the first round's retry-flag sharing).
- [x] Verified the fix is real, not just merged-but-inert, via live read-only queries
      against `/opt/veridian/ai-os/memory/superboss-register.sqlite`
      (per [[veridian-umr-tasks-live-query-and-self-mint-limits]] -- canonical script /
      read-only `sqlite3.connect(...mode=ro...)`, no raw-SQL writes, per this task's own
      instruction):
      - `tier=1 AND status='queued'` count is now **5**, all submitted 2026-08-06 09:13
        onward -- **zero** of the ~30 stuck 2026-08-04-dated rows the SPEC describes
        remain in that state.
      - Total `status='queued'` across all tiers: **27** (not the runaway/growing queue
        a still-open starvation bug would produce).
      - The SPEC's own three cited "stuck" UMRs -- UMR-20260806-081403-ebd3,
        UMR-20260806-083251-604c, UMR-20260806-084701-0d40 -- are **not** queued:
        live status is `running`, `killed`, `running` respectively. The SPEC's premise
        that "none of which have started" is stale/false at investigation time.
- [x] Checked for open PRs / worktrees that might indicate unfinished follow-on work on
      this topic: none found. `git worktree list` in `/opt/veridian/scripts` shows the
      fix's own now-merged worktree (`starvation-fix-worktree`,
      `fix/dispatch-queue-starvation-umr20260806090229-f2a7`), and `gh pr list` shows
      PR #153 as the only PR matching "f2a7" or "dispatch-queue-starvation", state MERGED.
      A separate, unrelated PR (#167, "auto-remediate dispatched dead-zone rows") covers a
      different failure mode (`status='dispatched'` rows going dead) and does not overlap.

## Remaining
- [x] None. This task is closed as a duplicate dispatch of already-completed,
      already-merged, already-verified-live work. No new code changes made -- per
      [[veridian-task-prompt-false-premise-pattern]] and
      [[veridian-orchestrator-router-pm-decision-duplicate-dispatch]], the correct action
      for a stale-premise dispatch is honest documentation, not re-doing (or worse,
      fabricating a second "root cause") work that already shipped.

## Evidence summary (for anyone re-reading this later)
- PR: https://github.com/FChecklist/veridian-scripts/pull/153 (MERGED, merge commit
  `27829980a0da470638e7f0f1ef5cdb69f701e718`)
- Live code: `/opt/veridian/scripts/resource_governor.py` (`MAX_QUEUED_AGE_SECONDS`,
  `flag_stale_queued_tasks()`), `/opt/veridian/scripts/directive_engine.py` (durable
  retry-gate, round 1 + round 2 hardening).
- Live DB verification: read-only query against
  `/opt/veridian/ai-os/memory/superboss-register.sqlite`, run 2026-08-06 during this
  task, showing 0 stale tier-1 rows remaining and the SPEC's 3 cited UMRs already past
  `queued`.
