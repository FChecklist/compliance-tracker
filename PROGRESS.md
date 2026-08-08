# PROGRESS -- task-20260808-141820-pm-decision-on-e122-s-architectural-ques

Governing chain: UMR-20260806-171945-5767, UMR-20260808-121334-e122 (gateway merge,
blocked on this architectural question), UMR-20260808-090151-c68e (dead-unit
reconciliation fix). This task's own UMR: UMR-20260808-141807-7f38.

## PM decision being implemented (e122, Option B)

Inline gate-check only, unchanged calling convention. Extract the real
stop-work-order + resource-threshold check into a shared function that both
`resource_governor.py`'s `dispatch_one()` and `task-gateway.py`'s `cmd_start`
call, rather than restructuring `cmd_start` into async submit-and-queue.

Real repo for this work: `/opt/veridian/scripts` (veridian-scripts, a SEPARATE
live-checkout repo from this task's own `compliance-tracker` workspace -- edits
there go live immediately regardless of push status, per prior session finding).
Branch: `fix/e122-shared-gate-check-cmd-start`.

`ai-os/boss/` (ACTIVE-CLAIMS.yaml) is transiently missing on disk right now
(known intermittent issue, prior session finding) -- could not register a claim
there before starting. Mitigated by real corroborating evidence instead: a
concurrent session's own memory note (modified 2026-08-08T14:25Z, ~7 min before
this task started) independently re-confirmed e122 is still unmerged and
explicitly deferred implementation rather than attempting it -- no live collision
expected.

## Completed
- [x] Read governing chain UMRs from the real DB (`/opt/veridian/ai-os/memory/superboss-register.sqlite`)
- [x] Confirmed live: `task-gateway.py cmd_start` has ZERO stop-work-order check
      and ZERO resource-threshold check today -- it calls `veridian-task.py create`
      then `systemctl --user start` directly, bypassing `resource_governor.py`
      entirely. `resource_governor.py`'s `_dispatch_one_inner()` (used by
      `dispatch_one()`) already has both checks, via `_stop_work_order_block_reason()`
      and `dispatch_core.has_free_slot_detail()`.
- [x] Confirmed live: the standing stop-work order is NOT currently blocking
      (`_stop_work_order_block_reason()` returns `None` right now) -- safe to do
      real code work.
- [x] Real finding (dead-unit-running rows), independently re-verified via
      `systemctl --user show`:
      - `UMR-20260808-122929-bc77` (task-20260808-125836, audit-24-points build):
        unit ActiveState=inactive/SubState=dead/Result=success; task.yaml status=blocked
        (declined, unmet queue dependency on e122); umr_tasks row still says
        status='running'. Dead-unit-running-row confirmed real.
      - `UMR-20260808-123107-875a` (task-20260808-125843, addendum): same pattern,
        unit dead, task.yaml status=blocked (declined), umr_tasks row still 'running'.
      - Also found (not in original ask, but same class, same governing chain):
        `UMR-20260808-121334-e122` itself -- unit
        `veridian-worker@task-20260808-121337-...` is inactive/dead, task.yaml
        status=blocked (declined 12:24 UTC on live stop-work-order-gate grounds,
        real commit a1f08b9a6), but its own umr_tasks row still says
        status='running'/reason='queued'.
      - Root cause confirmed: `UMR-20260808-090151-c68e` only ever ran a **read-only
        dry run** over the other 65 stale rows ("46 would_mark_failed, 16
        would_mark_running, 3 left_alone... not resolved this cycle per scope") --
        it diagnosed the class, it never wrote a real reconciliation fix, and no
        such fix is live on the dispatch path today. These 3 rows are not covered
        by any automatic mechanism; reconciling them requires a real
        `mark-umr-terminal` write per row, done here with cited evidence.

## Remaining
- [ ] Implement shared `check_stop_work_and_resource_gate()` in `resource_governor.py`
- [ ] Refactor `_dispatch_one_inner()` to call it (same order/conditions, no behavior change)
- [ ] Add `--check-dispatch-gate` CLI entry point
- [ ] Wire `task-gateway.py`'s `cmd_start` to call it before spending real resources
- [ ] Commit + push branch, open PR in veridian-scripts
- [ ] Reconcile bc77 / 875a / e122 umr_tasks rows via real `mark-umr-terminal`
- [ ] Record completion via `agent_work_briefing.py record-completion`
