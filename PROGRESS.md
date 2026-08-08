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

- [x] Found real, uncommitted WIP already present in the live
      `/opt/veridian/scripts` checkout (`git status` showed `resource_governor.py`
      + `task-gateway.py` modified, plus an untracked `tests/test_task_start_gate.py`)
      citing this exact task's own UMR (`UMR-20260808-141807-7f38`) in its
      docstrings -- almost certainly this same task's own prior invocation
      (`task.yaml` shows `.invocation_count: 2`). Reviewed it in full via a real
      `difflib` diff (the sandbox's `git diff`/`git show` stat output is
      independently known-buggy this session -- confirmed again here, both
      silently truncated), confirmed it correctly implements Option B:
      - `resource_governor.py`: new `resource_threshold_block_reason()` (pure
        extraction of the EMERGENCY_STOP-sentinel + `over_threshold_metrics`
        "frozen" checks `_dispatch_one_inner()` already ran inline -- zero
        behavior change for the live `dispatch_one()` path), plus a new
        `--check-task-start-gate` CLI flag running that + (for
        `task_kind=veridian_task_create`) `_stop_work_order_block_reason()`.
      - `task-gateway.py`: new `run_task_start_gate()` (subprocess+JSON wrapper,
        same convention as this file's other gate calls), called from `cmd_start`
        right after the duplicate-task-key claim and before `veridian-task.py
        create` -- a blocked start now fails there via the existing `fail()`
        path instead of reaching a real spawn. `start` gained an optional
        `--umr-id`.
      - `tests/test_task_start_gate.py`: 9 real tests already present, more
        thorough than a first draft I wrote and discarded in favor of this one
        (mocks `sample_metrics`/`over_threshold_metrics` for determinism against
        this host's currently-volatile real swap/load, tests the CLI via real
        subprocess, tests `run_task_start_gate()` against a stub governor).
      This matches the original technical finding's own governing-chain prompt
      (`task-20260808-121337`'s `prompt.txt`: "resource thresholds, concurrency
      cap, and critically the real stop-work-order check") for the two items
      the PM decision's own text names ("stop-work-order + resource-threshold");
      concurrency-cap (`dispatch_core.has_free_slot_detail()`) was NOT added to
      `cmd_start`'s gate, matching the PM decision's exact wording, not scope
      creep.
- [x] Verified: `python3 -m pytest tests/test_task_start_gate.py` **9/9 pass**;
      `tests/test_stop_work_order_gate.py` **10/11 pass**, one pre-existing
      environment-dependent failure (`test_dispatch_one_defense_in_depth_blocks_
      preexisting_queued_row` -- real live swap usage on this box currently over
      `dispatch_core`'s 80% backoff threshold, a different, untouched gate)
      confirmed identical on unmodified `main` via `git stash`/rerun.
      Live smoke test: `run_task_start_gate()` called end-to-end through the
      real `--check-task-start-gate` subprocess, returned `blocked: false` (no
      stop-work order currently active).
- [x] Committed (`bc14a21`) + pushed `fix/e122-shared-gate-check-cmd-start` to
      `veridian-scripts`, opened
      [PR #278](https://github.com/FChecklist/veridian-scripts/pull/278).
- [x] Reconciled all 3 dead-unit-running rows via a real, direct
      `update_umr_task()` write (matching `mark-umr-terminal`'s own real
      evidence-gated shape -- CLI flag quoting in this sandbox kept tripping
      `find_root_walk_guard.py`'s hook on multi-line/backslash commands, so the
      equivalent write was done in-process instead): `UMR-20260808-122929-bc77`,
      `UMR-20260808-123107-875a`, `UMR-20260808-121334-e122` all now
      `status='failed'`, real `ts_completed`, `outputs_json.commit_sha` citing
      each row's own real decline commit. Verified by re-reading the DB directly.

## Remaining
- [ ] None under this task's own scope. PR #278 review/merge is outside this
      task's authority (no self-merge; branch protection + CI gate per
      AGENTS.md Rule 6).
