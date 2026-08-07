# PROGRESS -- task-20260807-161539-correction-to-umr-20260807-161418-a63f

Correction to UMR-20260807-161418-a63f: the deterministic stop-work-order
gate must live in `resource_governor.py`'s `dispatch_one()` (real repo:
FChecklist/veridian-scripts, file `resource_governor.py`), not
`dispatch-owner-task.sh` -- because UMR-20260807-110133-205d's real incident
was an already-queued row picked up by the normal tick, which never passes
through a fresh `dispatch-owner-task.sh` submission call.

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, registered claim in this workspace's
      `ai-os/boss/ACTIVE-CLAIMS.yaml` (canonical per-repo location -- the
      separate live `/opt/veridian/ai-os` checkout has no `boss/` directory
      at all, confirmed live)
- [x] Identified a KNOWN COLLISION at claim time: task-20260807-161431-
      make-the-single-gate-deterministic--enfo (UMR-20260806-171945-5767),
      also in_progress, zero completed steps in ITS OWN task workspace's
      PROGRESS.md at that moment
- [x] Read `resource_governor.py` `dispatch_one()`/`_dispatch_one_inner()`
      in full (live checkout `/opt/veridian/scripts`) and confirmed the
      real critical section + existing metric/slot-check pattern
- [x] **Re-checked the shared live checkout before implementing (per this
      file's own Rule 4) and found the sibling session had, in the
      intervening minutes, ALREADY WRITTEN the real fix directly into the
      shared `/opt/veridian/scripts` working tree (uncommitted at
      discovery time, `resource_governor.py` +267 lines, new file
      `tests/test_stop_work_order_gate.py` +397 lines):**
      - `STOP_WORK_ORDER_TASK_IDS` well-known marker tuple (not free-text
        search) + `_stop_work_order_block_reason()` / `_git_committed_file_text()`
        (git-HEAD-only exemption reads, closing the exact fabricated-
        working-tree-only-exemption pattern this session has independently
        seen and declined 3x before -- see
        [[veridian-fabricated-exemption-laundered-into-uncommitted-yaml]])
      - Gate wired at BOTH `submit()` (admission time) AND inside
        `_dispatch_one_inner()`'s real critical section, after
        `next_queued_task()`, explicitly documented as "defense in depth...
        covers any row that reaches 'queued' by a different route: one
        queued before a stop-work order started, one queued before this
        gate itself existed" -- this is, verbatim, the exact 205d-shaped
        case (an old queued row, no fresh submission call) this correction
        task exists to require
      - Dedicated test `test_dispatch_one_defense_in_depth_blocks_
        preexisting_queued_row` seeds exactly that: a pre-existing
        `status='queued'` row with no `submit()` call, then asserts
        `dispatch_one()` returns `action == "blocked_stop_work_order"`
        with `outcome == "rejected"` -- the real boolean test this
        correction task specifies, already written
- [x] Ran `tests/test_stop_work_order_gate.py` standalone: **9/9 passed**
- [x] Ran the 6 nearest related dispatch test files as a regression check:
      13 failures, but root-caused every one to an UNRELATED, separate,
      concurrent, in-progress change already present in the same shared
      checkout (`superboss-register.py` truncated from ~4951 to ~41 lines
      in the live working tree vs git HEAD -- some other session's
      apparent orchestrator-consolidation work in flight, `git diff --stat`
      confirmed independently of the stop-work-order diff). Zero of the 13
      failures reference stop-work-order code; none are caused by this
      task's subject matter. Left untouched -- not this task's scope, and
      touching a different session's mid-edit shared file is exactly the
      collision this whole registry exists to prevent.

## Remaining / disposition
- [ ] **None for this task's own subject matter.** The real, deterministic
      fix this correction requires already exists, live, verified by its
      own passing test suite, authored by the concurrent session under
      UMR-20260806-171945-5767 / real issue #980 (its own code comments
      cite this task's governing UMR, UMR-20260807-161418-a63f, directly).
      Did NOT re-implement, did NOT commit/push/open a PR for someone
      else's uncommitted in-flight work -- that session's own lock file
      (`.task.lock`, mtime ~16:24Z) indicated it was still actively
      running at verification time; committing out from under it, in a
      checkout independently confirmed to have an unrelated broken file
      mid-edit at the same moment, would itself have been the exact kind
      of unsafe collision Rule 11/this registry exists to prevent.
- [x] Updated `ai-os/boss/ACTIVE-CLAIMS.yaml` to close out this session's
      claim as resolved-by-duplicate-discovery
- [x] Called `agent_work_briefing.py record-completion` for
      UMR-20260807-161517-bce6
