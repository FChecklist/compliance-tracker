# PROGRESS -- task-20260806-142146-pm-decision-on-ai-proposal-child-umr-202

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no active claim for
      `UMR-20260806-065104-c69a` / `orchestrator_router.py` from another
      session at investigation time.
- [x] Read `pm_decisions_pending` (read-only, via `sqlite3
      'file:/opt/veridian/ai-os/memory/superboss-register.sqlite?mode=ro'`)
      for `related_umr='UMR-20260806-065104-c69a'` -- found **two** real,
      already-closed rows, not an open one awaiting this decision:
  - id=6 (`decision_type='owner_proposal'`, the original AI proposal to add
    `orchestrator_router.py`): `status='redirected'`, closed
    `2026-08-06T07:42:38Z`, `closed_by='PM'`. `closed_note` verbatim: *"Redirect:
    do not build orchestrator_router.py yet. Hard Rule 2 (zero duplication)
    requires a real gap analysis against resource_governor.py, dispatch-tick.py,
    dispatch_core.py, task-gateway.py first, naming real function/line-level
    routing responsibility in each and whether it can be extended. See
    UMR-20260806-065104-c69a for the gap analysis once deposited."* -- this is
    **exactly** the redirect decision this task's own SPEC asks to be made and
    recorded. It was already made and recorded, ~6.5 hours before this task was
    dispatched (14:21:49Z).
  - id=11 (`decision_type='pm_decision'`, filed under the same
    `related_umr`): `status='approved_in_principle_held'`, closed
    `2026-08-06T08:04:33Z`. Records that the required gap analysis (dispatched
    as `UMR-20260806-075841-1e7e` / `owner-task-20260806-075839-2237258`) was
    actually done and reviewed: investigation/design quality accepted,
    zero-duplication check accepted as real, and three real gaps accepted as
    real (no cross-task agent-identity memory, no deterministic pre-dispatch
    reuse gate, no single standing-instruction routing point). Decision:
    **approved in principle, but HELD** -- not authorized to build
    `orchestrator_router.py` this cycle, because the standing Owner Priority
    Override gives dispatch capacity first to OCID-020 and the trailing-24h
    owner-dispatched closure mandate (`UMR-20260806-071025-1d28`). Hold lifts
    automatically once OCID-020 reports a real `CERTIFIED` boolean. One
    prerequisite (PR #114, `wiring_registry` `entity_type='script'`
    extension) was separately approved and independently re-verified here as
    **already MERGED** (commit `8cae23e`, `2026-08-06T07:36:48Z`, confirmed an
    ancestor of `veridian-scripts` `main`) -- no blocking checks remain to
    report on it.
- [x] Independently read the 4 named files this task's SPEC requires a gap
      analysis against, to verify the accepted gaps in id=11 are real (not
      taking the DB row on faith):
  - **`resource_governor.py`**: `submit(task_spec, tier, source_trigger)`
    (`resource_governor.py:481`) is the real submission entrypoint into the
    `umr_tasks` queue -- per-`task_identity` de-duplication via
    `sbr.find_active_umr_by_identity()` (called at `resource_governor.py:666`)
    and OCID-scoped de-dup via `sbr.find_active_umr_by_ocid()`
    (`resource_governor.py:704`). This deterministically rejects an exact
    repeat submission; it has no concept of "reuse an existing script" or
    "resume a prior agent's memory" for a *new*, textually-different intent --
    confirms real gap 3.2 (no deterministic pre-dispatch reuse/resume
    decision). Not extendable to cover that need without adding real new
    logic upstream of it (which is exactly what the held proposal's step 3
    already proposes: fall through to this function unchanged, never bypass
    it).
  - **`dispatch_core.py`**: `acquire_dispatch_lock()`
    (`dispatch_core.py:217-231`) + `has_free_slot()`
    (`dispatch_core.py:267-284`, delegating to `has_free_slot_detail()` at
    `246-264`) are the real, shared concurrency/resource-headroom gate --
    explicitly documented in its own module docstring (`dispatch_core.py:12-14`)
    as "a primitive, not a policy... never itself decides WHAT to dispatch...
    only gates HOW MANY." Confirmed this is not, and was never meant to be, a
    routing/reuse decision layer -- extending it to do reuse/resume routing
    would be a real, wrong layering violation, not a natural extension.
  - **`dispatch-tick.py`**: real responsibilities confirmed by function --
    `supervisor_sweep_tick()` (`dispatch-tick.py:156`, missed-trigger
    discovery), `resume_interrupted_workers_tick()`
    (`dispatch-tick.py:228`, reboot/crash resume via `task_identity=task_id`
    stability -- a real but narrow, single-purpose "resume" concept, only for
    a task resuming *itself* after interruption, not a general cross-task
    agent-identity resume), `find_stalled_running_tasks()`
    (`dispatch-tick.py:495`, 5-signal real stall detection),
    `gap_queue_tick()` (`dispatch-tick.py:1095`, `gap_queue.yaml` dispatch with
    its own `existing_scope_conflict()` duplication guard at
    `dispatch-tick.py:1027`). None of these give a *new*, not-yet-dispatched
    intent a deterministic "reuse script X" or "resume agent Y" answer before
    a worker spawn decision is made -- each operates on already-queued or
    already-dispatched state, not on intent-to-route triage. Not extendable
    to close gap 3.3 (single standing-instruction routing point) without
    adding a genuinely new responsibility this script does not have today.
  - **`task-gateway.py`**: `cmd_submit` (`task-gateway.py:209`) sequences the
    v2 task-lifecycle pipeline (`OWNER_ENGINE` prompt gating via
    `run_owner_engine_gate()` at `task-gateway.py:96`, then
    `superboss-register.py`/`veridian-task.py` calls) into one CLI -- per its
    own module docstring (`task-gateway.py:9-14`), "delegated to the
    already-built script it wraps... does not reimplement any of their
    internal logic." It is a lifecycle-phase sequencer for a task that has
    already been decided on, not a pre-dispatch reuse/resume/routing
    decision-maker -- confirms the same gap 3.3/3.2 finding from the other
    angle (it assumes routing already happened).
  - **Conclusion, independently reached and matching id=11's own accepted
    findings**: none of the 4 named files can be extended to close the 3
    named gaps without adding a genuinely new, currently-absent
    responsibility (cross-task agent-identity memory keyed by something
    other than an ephemeral `task_id`; a deterministic pre-dispatch
    reuse/resume gate; a single standing-instruction ingestion point). The
    real gaps are real. The minimum real change already proposed for them
    (one new additive file + one new additive table, falling through
    unchanged into `resource_governor.submit()`/`dispatch_core`'s existing
    gates) is the same minimum-change shape this task's SPEC asks for --
    already produced, already reviewed, already decided (approved in
    principle, held).
- [x] Confirmed this task is a **duplicate dispatch**, not new work: a
      sibling task, `task-20260806-142201-pm-decision-on-orchestrator-router-propo`
      (created 15 seconds after this one, `UMR-20260806-075841-1e7e`'s own
      `outputs_json.new_task_id`), independently reached and recorded the
      identical conclusion first (commit `45ad00b9`, `2026-08-06T14:23:42Z`,
      *"docs: close orchestrator_router.py PM-decision task as duplicate
      dispatch"*). Both this task and that one were spawned from the same
      underlying already-decided UMR chain within the same minute.
- [x] Verified live (not from a stale citation) that no third open
      `pm_decisions_pending` row or `umr_tasks` row exists still awaiting this
      decision for `related_umr='UMR-20260806-065104-c69a'` -- only the two
      closed rows above (ids 6, 11).

## Remaining
None. No new `pm_decisions_pending` row written (per Hard Rule 2, this would
be a real duplicate of the canonical record already at id=6/id=11 for the
same `related_umr`, written via the canonical `superboss-register.py`
`insert-owner-proposal`/`decide-owner-proposal` commands, never raw SQL). No
`orchestrator_router.py` or any other new routing file created. No further
DB write of any kind was needed or performed by this task -- the real
deliverables this SPEC asked for (gap analysis naming each of the 4 files
with function/line citations + extendability verdict, and a decision written
back to the child UMR row via the canonical script) already exist, verified
independently above, not merely cited on trust from the sibling task's
commit.

**Real next step for a future cycle (not this task's to take):** re-check
OCID-020's `CERTIFIED` boolean; once true, the hold on id=11's
`approved_in_principle_held` decision lifts automatically per that row's own
`closed_note`, at which point a genuinely new `insert-owner-proposal` (not a
raw SQL update to the closed id=6/id=11 rows) would carry the build-go-ahead
forward.
