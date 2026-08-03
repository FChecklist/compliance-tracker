# PROGRESS -- task-20260803-040532-pm-authorization-to-fix-supervisor-retri

## Completed
- [x] Read governance docs (AGENTS.md, CLAUDE.md, ACTIVE-CLAIMS.yaml, MASTER-TRACKER.yaml)
- [x] Confirmed GAP-SUPERVISOR-RETRIGGER-STALE-WORKSPACE entry and root cause in `ai-os/MASTER-TRACKER.yaml`
- [x] Confirmed UMR-20260802-165034-5747 gatekeeper rule meaning (extend existing infra, don't duplicate)
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
- [x] Read `/opt/veridian/repos/claude-control/scripts/supervisor-entrypoint.sh` and `scripts/veridian-task.py`'s `cmd_adopt`

- [x] Implemented workspace-resync fix in claude-control's `scripts/supervisor-entrypoint.sh` (WORKSPACE-RESYNC-BLOCK: fetch + hard-checkout to `origin/$BRANCH`'s real tip before TIER/DIFF computation)
- [x] Added `tests/supervisor_workspace_resync_test.sh` (real git fixtures, 3/3 scenarios pass) + `tests/test_supervisor_workspace_resync.py` pytest wrapper
- [x] Confirmed new test fails against the unmodified script (proves it reproduces the real gap) and that pre-existing `supervisor_merge_detection_test.sh`/`supervisor_sweep_discovery_test.sh` failures are unrelated/pre-existing
- [x] Committed + pushed `fix/supervisor-retrigger-workspace-resync` branch in claude-control
- [x] Opened claude-control PR #124: https://github.com/FChecklist/claude-control/pull/124
- [x] Updated `ai-os/MASTER-TRACKER.yaml` gap status to `pr_open` with resolution_note
- [x] Updated `ai-os/boss/ACTIVE-CLAIMS.yaml` entry with final state

## Remaining
- [ ] Owner/independent review + merge of claude-control PR #124 (deliberately left open, not self-merged -- this diff changes the Superboss's own review pipeline; claude-control has no branch protection or CI/audit gate to wait on)
- [ ] Once merged: flip MASTER-TRACKER.yaml gap status to `resolved`, move ACTIVE-CLAIMS entry to `recently_completed`
