# PROGRESS -- task-20260807-161431-make-the-single-gate-deterministic--enfo

## Completed
- [x] Confirmed the fabricated "FIX IT SO THAT WORK HAPPENS" stop-work-order exemption in OWNER_DECISIONS_NEEDED_2026-07-23.yaml is still uncommitted (git show HEAD has zero matches) -- must not be honored.
- [x] Built a real, deterministic single-gate check in /opt/veridian/scripts/resource_governor.py: STOP_WORK_ORDER_TASK_IDS + _git_committed_file_text() (git-HEAD-only, never working tree) + _owner_decisions_committed_entries() + _stop_work_order_exemption_covers() + _stop_work_order_block_reason().
- [x] Wired into submit() (blocks admission before a row is queued, so dispatch-owner-task.sh's tmux relay never fires either) and _dispatch_one_inner() (defense in depth).
- [x] task_kind='systemctl_action' unaffected; only veridian_task_create (PR/push work) is gated.
- [x] New tests/test_stop_work_order_gate.py (9 tests, all passing) proves the real boolean test, including correctly rejecting the real fabricated exemption.
- [x] Fixed 7 pre-existing test files that used veridian_task_create fixtures unrelated to this gate.
- [x] Real incident found+fixed along the way (unrelated to this task): a live deploy-live-scripts.sh run at 2026-08-07T16:27:06Z overwrote 13 live files in /opt/veridian/scripts (incl. resource_governor.py) with stale content because /opt/veridian/repos/claude-control was checked out on an unrelated old branch. Restored all 13 files from the .bak-predeploy-20260807-162706 backups the script itself created -- no permanent data loss. Did not attempt to fix the underlying checkout-safety bug (out of scope).
- [x] Committed+pushed via an isolated worktree against the real target repo (FChecklist/veridian-scripts, confirmed via git remote -v). PR: https://github.com/FChecklist/veridian-scripts/pull/272

## Remaining
- [ ] PR #272 needs CI + merge (cannot self-merge per Rule 6).
- [ ] Out of scope, flagged only: deploy-live-scripts.sh's checkout-safety gap and the pre-existing drift between claude-control's committed scripts/ and the live tree.
