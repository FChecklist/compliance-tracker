## Real defect (P0 platform blocker, task-20260815-041536-urgent-platform-blocker--dispatch-queue, UMR-20260806-102737-d780)

PM sentinel cycle 2026-08-06T10:30Z (UMR-20260806-071025-1d28 / UMR-20260806-090229-f2a7 stale-queued safeguard) found directive_engine.py's run_check_duplicate_battery() failed OPEN on any exception from its task-gateway.py submit subprocess call: it caught the exception, logged "check-duplicate battery call failed, fail-open, proceeding", and returned bare None -- indistinguishable from "the battery genuinely ran and found no duplicate". process_one() then fell through unconditionally to submit_task().

Live incident evidence: veridian-directive-engine.service's own journal recorded that exact log line immediately followed by "submitted" on literally every tick, for eight distinct dead task_identity values, ~52 resubmissions each within one 15-minute window (~416 total resubmissions). Each resubmission reused the same umr_id via resource_governor.py submit()'s Rule-1 reuse-on-resubmit path, whose ts_submitted is never refreshed on reuse -- the resubmitted row's age never reset, so it permanently won next_queued_task()'s ascending-ts_submitted tiebreak against every other real queued row. dispatch_one()/run_tick() only ever evaluate the single top-ranked row per tick, so this one poisoned row starved the entire rest of the queue.

## Fix

run_check_duplicate_battery() now returns (result, call_failed) instead of a bare result. call_failed=True whenever the subprocess/parse itself failed. process_one() checks that flag before ever calling submit_task(): on a real battery-call failure it now skips submission and calls note_needs_review() to flag for Owner review (fails CLOSED), instead of silently proceeding.

Two pre-existing tests in tests/test_directive_engine_retry_gate.py relied (unintentionally, via the old fail-open bug) on an unmocked task-gateway.py subprocess call that genuinely fails in the sandboxed test environment -- they're updated to mock run_check_duplicate_battery() to a real successful/no-duplicate result, since they test the retry-once gate in isolation, not the duplicate-battery subprocess path itself. New tests/test_directive_engine_fail_closed_duplicate_battery.py covers: battery-call failure returns (None, True); battery-call success returns (result, False); process_one() never calls submit_task() when the battery call itself failed; the healthy no-duplicate path still submits; the pre-existing duplicate_found=True path is unaffected.

All 12 real tests pass (tests/test_directive_engine_retry_gate.py 7/7, tests/test_directive_engine_fail_closed_duplicate_battery.py 5/5), plus the pre-existing unrelated test_directive_engine_stop_audit_monitor.py (16/16).

## Scope note (cross-repo completion evidence)

This fix lands here (veridian-scripts) rather than in the dispatching task's own compliance-tracker workspace -- the real defect lives in this repo's /opt/veridian/scripts/directive_engine.py, a live-checkout of veridian-scripts, not in compliance-tracker. Per progress_completion_gate.py's own documented cross-repo completion path (find_cross_repo_pr_evidence()), this PR's real diff -- headRefName carrying the dispatching task_id, directive_engine.py present in files -- is the completion evidence for that task.

Part 1 (durably disable veridian-directive-engine.service), Part 3 (mark stale keystone queued rows terminal), and Part 4 (verify the queue drains) of the governing SPEC were independently found already resolved by prior work / self-correcting reconcilers at task start (2026-08-15T04:20Z) -- see that task's own progress/task-20260815-041536-urgent-platform-blocker--dispatch-queue.md for the full live evidence. This PR is the one remaining real gap: the fail-closed code fix itself.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
