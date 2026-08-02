# PROGRESS -- task-20260802-074612-extend-dispatch-tick-py-with-stuck-task

## Completed
- [x] Read AGENTS.md/CLAUDE.md, ai-os/boss/ACTIVE-CLAIMS.yaml (registered claim, no collision), ai-os/MASTER_INDEX.yaml (no existing stuck-task/heartbeat file convention to extend)
- [x] Confirmed real target: `/opt/veridian/scripts/dispatch-tick.py` lives in the SEPARATE live-checkout repo `FChecklist/veridian-scripts` (per memory `veridian-scripts-separate-repo-live-checkout`), not this compliance-tracker repo -- this task's own `repo: compliance-tracker` task.yaml field is just this session's tracking workspace
- [x] Read dispatch-tick.py + dispatch_core.py + resource_governor.py (EMERGENCY_STOP_PATH) + a real blocked task.yaml to understand task status/checkpoint schema

## Remaining
- [ ] Clone a fresh working copy of FChecklist/veridian-scripts (the live checkout at /opt/veridian/scripts has other sessions' uncommitted WIP -- do not touch/commit those), branch off main
- [ ] Add stuck-task detection + heartbeat write to dispatch-tick.py (same tick, same file, no new script/timer, read-only w.r.t. task state)
- [ ] Write real tests (test_stuck_task_heartbeat.py, following test_worker_boot_activation_and_resume.py's real-executable-assertions convention)
- [ ] Commit, push, open PR against FChecklist/veridian-scripts main
- [ ] Report real PR number + real heartbeat file path back to user
