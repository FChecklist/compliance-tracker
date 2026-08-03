# PROGRESS -- task-20260803-040532-pm-authorization-to-fix-supervisor-retri

## Completed
- [x] Read governance docs (AGENTS.md, CLAUDE.md, ACTIVE-CLAIMS.yaml, MASTER-TRACKER.yaml)
- [x] Confirmed GAP-SUPERVISOR-RETRIGGER-STALE-WORKSPACE entry and root cause in `ai-os/MASTER-TRACKER.yaml`
- [x] Confirmed UMR-20260802-165034-5747 gatekeeper rule meaning (extend existing infra, don't duplicate)
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
- [x] Read `/opt/veridian/repos/claude-control/scripts/supervisor-entrypoint.sh` and `scripts/veridian-task.py`'s `cmd_adopt`

## Remaining
- [ ] Implement workspace-resync fix in claude-control's `scripts/supervisor-entrypoint.sh`
- [ ] Add regression test `tests/supervisor_workspace_resync_test.sh` reproducing the stale-workspace condition
- [ ] Run the new test + existing supervisor tests locally
- [ ] Commit on a new branch in claude-control, push, open PR citing UMR-20260803-025317-0c64 and GAP-SUPERVISOR-RETRIGGER-STALE-WORKSPACE
- [ ] Post AUDIT verdict / follow PR gate protocol as needed
- [ ] Update MASTER-TRACKER.yaml gap status to closed/PR-open once real
- [ ] Move ACTIVE-CLAIMS entry to recently_completed on merge
