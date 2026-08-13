# PROGRESS -- task-20260813-105503-rca--umr-20260808-150937-43d0-killed

## Completed
- [x] Queried real row: `resource_governor.py --query-umr --umr-id UMR-20260808-150937-43d0`
      -- task_kind=systemctl_action, unit_name=veridian-superboss-gateway.service,
      action=start, registration_only=true. reason="stuck-task SIGKILL: no exit 60s
      after SIGTERM". ts_dispatched 15:09:45, ts_sigterm 15:10:16 (+31s), ts_completed
      15:11:18 (+62s after SIGTERM, matches SIGTERM_TO_SIGKILL_GRACE_SECONDS=60).
- [x] Root-caused in resource_governor.py: scan_stuck_tasks()'s `WHERE status='running'
      AND unit_name IS NOT NULL` query had no task_kind filter, so it swept in this
      systemctl_action row (whose unit_name is the persistent
      veridian-superboss-gateway.service daemon, Restart=always/on-failure,
      WantedBy=default.target -- meant to run forever) and measured elapsed time since
      the unit's real (already-old) ActiveEnterTimestamp against
      STUCK_TASK_TIMEOUT_SECONDS=3600s -- same ephemeral-task-exit assumption that is
      correct for veridian_task_create/veridian-worker@<id>.service rows but wrong here.
- [x] Confirmed live impact: `systemctl --user is-enabled veridian-superboss-gateway.service`
      -> disabled, ActiveState -> inactive (dead) -- still down 5 days after the 2026-08-08
      kill when this RCA ran on 2026-08-13. Checked for downstream breakage: no consumer
      calls 127.0.0.1:8790 yet (git grep 8790 across compliance-tracker + veridian-scripts
      -> only the gateway's own files + this UMR row), so no live outage resulted, but
      this is a real bug in the governor's own stuck-task safety net.
- [x] Confirmed via direct sqlite query against superboss-register.sqlite: among 6436
      systemctl_action rows, UMR-20260808-150937-43d0 is the ONLY one ever killed via
      this stuck-task path -- a genuine one-off, not a recurring pattern.
- [x] Fix implemented in resource_governor.py: scan_stuck_tasks()'s running-row query now
      filters `task_kind='veridian_task_create'`, exempting systemctl_action rows entirely
      (their real outcome is already resolved synchronously by _perform_spawn()).
- [x] Added tests/test_resource_governor_stuck_task_scope.py: reproduces the bug against
      pre-fix code (confirmed FAIL), confirms the fix (systemctl_action row never
      SIGTERM'd) and a control case (veridian_task_create row still SIGTERM'd as before).
      Also re-ran existing tests/test_ocid_artifact_links.py (6/6 pass) and
      test_resource_governor_owner_priority_advance.py (2/2 pass) -- no regressions.
- [x] Isolated the change in a fresh worktree off origin/main (the shared live checkout
      at /opt/veridian/scripts was on an unrelated in-progress worker branch with 2
      unpushed commits -- left untouched, not disturbed). Committed, pushed
      fix/rca-umr-43d0-stuck-task-scan-scope, opened and merged PR
      https://github.com/FChecklist/veridian-scripts/pull/296 (squash-merged to main).
- [x] Restored the live consequence: `systemctl --user enable` +
      `systemctl --user start veridian-superboss-gateway.service` -- confirmed
      active(running) and healthy via `curl 127.0.0.1:8790/health` ->
      {"ok": true, "db": "/opt/veridian/ai-os/memory/superboss-register.sqlite",
      "journal_mode": "wal"}.
- [x] Recorded completion via agent_work_briefing.py record-completion
      (UMR-20260813-101757-f13c).

- [x] Re-verified live on resume (invocation 4/20, 2026-08-13T11:29Z checkpoint):
      PR #296 confirmed MERGED (mergedAt 2026-08-13T11:05:24Z);
      `systemctl --user is-active/is-enabled veridian-superboss-gateway.service` ->
      active/enabled; `curl 127.0.0.1:8790/health` -> {"ok": true, ...}. Original
      UMR-20260808-150937-43d0 row intentionally left status=killed (it genuinely was
      killed -- honest history, same pattern as UMR-cebd; the RCA's own completion is
      tracked separately via UMR-20260813-101757-f13c per agent_work_briefing.py). No
      new work found or needed.

## Remaining
- [ ] None for this RCA's own scope. Separate, pre-existing, out-of-scope observation
      (not touched here): the live checkout at /opt/veridian/scripts is currently on
      branch worker/task-20260813-091931-amendment--server-native-pm-escalation-p (an
      unrelated concurrent session's WIP, 2 commits ahead of origin/main, unpushed) --
      the merged fix (PR #296) is on GitHub main but the live checkout won't run it until
      that branch situation resolves and a sync/deploy happens. Flagging, not fixing --
      switching branches on a shared live checkout out from under another active session
      would be its own risk.
