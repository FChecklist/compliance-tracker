# PROGRESS -- task-20260802-074400-pm-decision--scope-the-reconcile-stale-h

## Completed
- [x] Read AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml governance chain
- [x] Located the real subject: `resource_governor.py` / `resource_governor_tick_loop.sh` in
      `FChecklist/veridian-scripts` (separate live-checkout repo, not compliance-tracker),
      via the interactive tmux session (`tmux capture-pane -t claude:0`) and
      `/opt/veridian/scripts/resource_governor.py.bak-predeploy-20260730-040659` (the
      pristine pre-bad-deploy backup)
- [x] **Found a collision**: the interactive tmux session did NOT wait for this PM decision --
      at 07:49:53 (5 min after this task was dispatched at 07:44:00) it committed (95f5da9) and
      opened `FChecklist/veridian-scripts#13` bundling reconcile_stale_heartbeats together with
      8 other restorations (find_pr_for_task_identity, exception-safety wrapping, MAX_TASK_IDENTITY_LEN,
      _state_file_lock, a separate zombie-worker fix, backfill_null_heartbeats (added but not
      invoked), forensic EMERGENCY_STOP metrics logging) -- violating the narrow-scope decision.
      It also already live-hotpatched `/opt/veridian/scripts/resource_governor.py` directly
      (uncommitted, ahead of git) with the same full bundle.
- [x] Decision: did not revert the already-live production hotpatch (destructive, re-risks real
      bugs the other 8 items were fixing, not asked of me) and did not rewrite/force-push PR #13
      (another live session's active work). Instead opened a clean, independent, narrowly-scoped
      PR off `origin/main` containing only reconcile_stale_heartbeats() + `--reconcile-stale` +
      its hard dependency `_unit_exit_terminal_status()` (called from inside
      reconcile_stale_heartbeats itself -- not scope creep) + the `run_governor` exit-code guard
      in `resource_governor_tick_loop.sh` that makes the original silent-failure regression class
      loud next time.
- [x] Verified: `python3 -m py_compile` + `bash -n` both clean; new standalone test
      `test_reconcile_stale_heartbeats.py` (same no-pytest convention as this repo's other
      `test_*.py` files) exercises the real systemd KEY=VALUE parsing + NULL/fresh/still-active
      skip paths against a temp sqlite DB -- **PASS**; manual CLI run
      (`--reconcile-stale` against a throwaway DB) returns `{"actions": []}` clean
- [x] Opened **FChecklist/veridian-scripts#16** (https://github.com/FChecklist/veridian-scripts/pull/16)
      -- OPEN, MERGEABLE. Repo has no CI (`.github/workflows` doesn't exist there), so Rule 10's
      mandatory-audit-check doesn't apply to this repo; left the PR open rather than self-merging.
- [x] Logged the finding (the ~8 other already-shipped-outside-scope restorations,
      backfill_null_heartbeats still genuinely not run, Phase 7/disk-io kept-as-is) in two durable
      places: `ai-os/boss/ACTIVE-CLAIMS.yaml` (2026-08-02 entry, full collision writeup) and
      `ai-os/MASTER-TRACKER.yaml` `open_items.needs_owner_decision` as `OPEN-11`

## Remaining
- [ ] None -- task complete. PR #16 awaiting Owner review/merge; OPEN-11 awaiting Owner
      priority/retroactive-scope decision on PR #13's bundle + the backfill go-ahead
