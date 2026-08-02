# PROGRESS -- task-20260802-074612-extend-dispatch-tick-py-with-stuck-task

## Completed
- [x] Read AGENTS.md/CLAUDE.md, ai-os/boss/ACTIVE-CLAIMS.yaml (registered claim, no collision), ai-os/MASTER_INDEX.yaml (no existing stuck-task/heartbeat file convention to extend)
- [x] Confirmed real target: `/opt/veridian/scripts/dispatch-tick.py` lives in the SEPARATE live-checkout repo `FChecklist/veridian-scripts` (per memory `veridian-scripts-separate-repo-live-checkout`), not this compliance-tracker repo -- this task's own `repo: compliance-tracker` task.yaml field is just this session's tracking workspace
- [x] Read dispatch-tick.py + dispatch_core.py + resource_governor.py (EMERGENCY_STOP_PATH) + a real blocked task.yaml to understand task status/checkpoint schema

- [x] Cloned a fresh working copy of FChecklist/veridian-scripts to /tmp/veridian-scripts-work (the live checkout at /opt/veridian/scripts has other sessions' uncommitted WIP in unrelated files -- did not touch/commit those), branched `feat/dispatch-tick-stuck-task-heartbeat` off main
- [x] Added `find_stuck_tasks()` + `write_stuck_tasks_heartbeat()` to dispatch-tick.py, wired into `main()`, same tick/file, no new script/timer, read-only w.r.t. task state. Canonical file: `ai-os/STUCK_TASKS_HEARTBEAT.json` (`/opt/veridian/ai-os/STUCK_TASKS_HEARTBEAT.json` on the live box)
- [x] Wrote real tests: `test_stuck_task_heartbeat.py` (27 assertions, following `test_worker_boot_activation_and_resume.py`'s real-executable-assertions convention) -- all pass; pre-existing `test_worker_boot_activation_and_resume.py` still passes (no regression)
- [x] Dry-ran against the real 842 task.yaml files on the box (read-only, temp output path): 424 genuinely stuck, real load average, correct counts
- [x] Committed, pushed, opened PR: **https://github.com/FChecklist/veridian-scripts/pull/14**
- [x] Moved this session's ACTIVE-CLAIMS.yaml entry to recently_completed

## Remaining
- [ ] Normal audit / merge of PR #14 (not self-merged, per protocol)
