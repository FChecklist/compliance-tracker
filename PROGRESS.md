# PROGRESS -- task-20260802-074400-pm-decision--scope-the-reconcile-stale-h

## Completed
- [x] Read AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml governance chain
- [x] Located the real subject: `resource_governor.py` / `resource_governor_tick_loop.sh` in
      `FChecklist/veridian-scripts` (separate live-checkout repo, not compliance-tracker),
      via the interactive tmux session (`tmux capture-pane -t claude:0`) and
      `/opt/veridian/scripts/resource_governor.py.bak-predeploy-20260730-040659` (the
      pristine pre-bad-deploy backup)
- [x] First pass: opened a narrowly-scoped PR (`FChecklist/veridian-scripts#16`) containing
      only `reconcile_stale_heartbeats()` + `--reconcile-stale` + its hard dependency
      `_unit_exit_terminal_status()` + the tick-loop exit-code guard, verified with
      `py_compile`/`bash -n`/a new standalone test (PASS) -- believing at the time that
      `FChecklist/veridian-scripts#13` (which bundled the same restore with 8 others, and
      had already been live-hotpatched) was an uncoordinated scope violation by a parallel
      session.
- [x] **Found and corrected a mistaken conclusion**: `task-20260802-074148-governance-regression--restore-reconcile`
      (dispatched 07:41:49, ~2 min before this task) independently reached the identical
      narrow diagnosis and was mid-restoration when cancelled at 07:49:02; its own task.yaml
      records the reason verbatim -- "duplicate of the same Sentinel finding... The
      interactive session's work, done with **explicit Owner approval**, additionally
      restores 7 more silently-lost functions... Superseded, not lost." This is
      independent, contemporaneous confirmation that PR #13's broader bundle was a
      real-time, explicit Owner decision, not scope creep.
- [x] Closed PR #16 as redundant (comment explains why, links to #13). #13 is the real,
      Owner-approved PR that covers reconcile_stale_heartbeats() (and 8 other restorations).
- [x] Corrected `ai-os/boss/ACTIVE-CLAIMS.yaml` (added a CORRECTION addendum after the
      original entry, not a silent rewrite) and rewrote `ai-os/MASTER-TRACKER.yaml`'s
      `OPEN-11` to reflect the corrected picture: the only genuinely still-open item is
      `backfill_null_heartbeats()` needing its own explicit Owner go-ahead to run (a
      one-time data op, deliberately not bundled into #13's approval). Phase 7 / disk-io
      were never a restore question -- both already kept as-is in the live base.
- [x] Opened `FChecklist/compliance-tracker#703` for these docs-only governance changes.

## Remaining
- [ ] None -- task complete. Real PR for `reconcile_stale_heartbeats()`: **#13**
      (https://github.com/FChecklist/veridian-scripts/pull/13), OPEN, Owner-approved,
      awaiting merge (not by this task). `#16` closed as redundant. `OPEN-11` (only
      remaining item: `backfill_null_heartbeats()` go-ahead) logged in both
      `ai-os/MASTER-TRACKER.yaml` and `ai-os/boss/ACTIVE-CLAIMS.yaml`.
