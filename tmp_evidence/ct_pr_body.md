## P0 platform blocker: dispatch-queue starvation (UMR-20260806-102737-d780)

Governed by UMR-20260806-071025-1d28 / UMR-20260806-090229-f2a7 (PM sentinel cycle, 2026-08-06T10:30Z).

Live re-verification at task start (2026-08-15T04:20Z) found 3 of the SPEC's 4 required parts already resolved by prior work / self-correcting reconcilers:

- **Part 1** (durably disable `veridian-directive-engine.service`): already `disabled`/`inactive`, no `default.target.wants` symlink.
- **Part 3** (mark stale keystone queued rows terminal): UMR-20260729-112414-3269 already `status: completed` via heartbeat-sweep reconciler, 2026-08-06T11:17:18Z. Live-checked the current 20 queued rows -- 0 further stale/resubmitted candidates.
- **Part 4** (verify the queue drains): queued count 20 (well under the SPEC's original 41), 4-5/5 `veridian-worker@*` units running throughout.

**Part 2** (the fail-closed code fix) was the one real remaining gap: `directive_engine.py`'s `run_check_duplicate_battery()` failed OPEN on any exception, returning bare `None` indistinguishable from "no duplicate found" -- matching the SPEC's cited journal lines exactly.

This repo's task branch diff is docs/evidence only (`progress/*.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml`, `tmp_evidence/*`) -- the real code fix lives in a separate repo, `veridian-scripts` (a live-checkout at `/opt/veridian/scripts`, not `compliance-tracker`), per `progress_completion_gate.py`'s own documented cross-repo completion path (`find_cross_repo_pr_evidence()`):

- Real commit: `60c8eed` on branch `worker/task-20260815-041536-urgent-platform-blocker--dispatch-queue` in `FChecklist/veridian-scripts`.
- Real PR: https://github.com/FChecklist/veridian-scripts/pull/405 (created 2026-08-15T04:24:14Z, after this task's own dispatch; `directive_engine.py` + 2 test files in its real `files` list; `mergeStateStatus: CLEAN`).
- 12 real tests pass across both the new and pre-existing directive_engine.py test files.

Full evidence, before/after counts, and rationale: `progress/task-20260815-041536-urgent-platform-blocker--dispatch-queue.md`.

Per AGENTS.md Operating Rule 6, this task does not merge either PR itself -- both are left for the standard review/merge pipeline. Per the SPEC's own instruction, `veridian-directive-engine.service` is not restarted until the fail-closed fix (PR #405) is genuinely merged and verified.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
