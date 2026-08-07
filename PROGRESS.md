# PROGRESS -- task-20260807-161539-correction-to-umr-20260807-161418-a63f

Correction to UMR-20260807-161418-a63f: the deterministic stop-work-order
gate must live in `resource_governor.py`'s `dispatch_one()` (real repo:
FChecklist/veridian-scripts, file `resource_governor.py`), not
`dispatch-owner-task.sh` -- because UMR-20260807-110133-205d's real incident
was an already-queued row picked up by the normal tick, which never passes
through a fresh `dispatch-owner-task.sh` submission call.

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, CONSTITUTION.yaml context, registered claim
      in this workspace's `ai-os/boss/ACTIVE-CLAIMS.yaml` (canonical
      per-repo location -- the separate live `/opt/veridian/ai-os` checkout
      has no `boss/` directory at all, confirmed live)
- [x] Identified a KNOWN COLLISION: task-20260807-161431-make-the-single-
      gate-deterministic--enfo (UMR-20260806-171945-5767) targets the
      identical real file/function (`resource_governor.py` `dispatch_one`),
      also in_progress, zero completed steps at claim time
- [x] Read `resource_governor.py` `dispatch_one()`/`_dispatch_one_inner()`
      in full (FChecklist/veridian-scripts, live checkout at
      `/opt/veridian/scripts`) -- confirmed the real critical section
      (`with dc.acquire_dispatch_lock():`) and the existing
      metric/slot-check pattern (`over_threshold_metrics`,
      `has_free_slot_detail` -> `slot_detail` incl. `swap_backoff`/
      `cap_exhausted`) this new check must follow
- [x] Confirmed no existing deterministic stop-work-order marker/check
      exists anywhere in `resource_governor.py` (only `EMERGENCY_STOP`
      sentinel-file pattern exists today, for a different concept)

## Remaining
- [ ] Re-check task-20260807-161431's live branch/PR state immediately
      before implementing, to avoid a duplicate/conflicting change
- [ ] Design deterministic "is a stop-work order open" signal (well-known
      sentinel file or capability_registry/wiring_registry-backed check,
      not free-text search) + exemption path
- [ ] Implement the check inside `_dispatch_one_inner()`'s critical
      section, gated to PR/push-requiring queued rows
      (`task_kind == "veridian_task_create"`)
- [ ] Add/extend a real test seeding a queued row requiring PR/push work
      while a stop-work order is open, proving `dispatch_one()` blocks it
      deterministically at execution time (the exact 205d-shaped case: an
      old queued row, no fresh submission call)
- [ ] Commit + push to FChecklist/veridian-scripts on its own branch, open
      PR
- [ ] Call `agent_work_briefing.py record-completion` for
      UMR-20260807-161517-bce6
