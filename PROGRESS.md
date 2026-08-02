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
      _state_file_lock, _unit_exit_terminal_status, zombie-worker fix, backfill_null_heartbeats
      (added but not invoked), forensic EMERGENCY_STOP metrics logging) -- violating the narrow-scope
      decision. It also already live-hotpatched `/opt/veridian/scripts/resource_governor.py` directly
      (uncommitted, ahead of git) with the same full bundle.
- [x] Decision: did not revert the already-live production hotpatch (destructive, re-risks real
      bugs the other 8 items were fixing, not asked of me) and did not rewrite/force-push PR #13
      (another live session's active work). Instead opened a clean, independent, narrowly-scoped
      PR off `origin/main` containing only reconcile_stale_heartbeats() + `--reconcile-stale` +
      its hard dependency `_unit_exit_terminal_status()` + the `run_governor` exit-code guard in
      `resource_governor_tick_loop.sh`.

## Remaining
- [ ] Verify with a real Python syntax check + a targeted test exercising
      `reconcile_stale_heartbeats()`
- [ ] Open PR (narrow diff only)
- [ ] Write up the finding for the other ~11 functions/Phase 7/disk-io improvement, noting they
      are ALREADY shipped (PR #13 + live hotpatch) outside the approved narrow scope, for PM
      retroactive-review triage -- log it in ACTIVE-CLAIMS.yaml or MASTER-TRACKER.yaml
- [ ] Report real PR number back to the user
- [ ] Confirm finding is logged somewhere durable
