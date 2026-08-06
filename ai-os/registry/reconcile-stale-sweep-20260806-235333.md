# Reconcile-stale sweep -- UMR-20260806-235333-3587

**Parent:** UMR-20260806-071025-1d28 (24h closure mandate)
**Cites:** UMR-20260806-042531-be9c (Deterministic PM Reporting Contract V3, `generate_pm_report_v3.py`)
**Child UMR minted (real, via canonical registrar):** `UMR-20260806-235333-3587`
  (`resource_governor.py --submit` -> `superboss-register.py`'s `upsert_umr_task()`,
  then `superboss-register.py mark-umr-terminal --status completed` recording this
  session's genuine inline completion -- this is the documented use case #2 for that
  command: "any worker or interactive session recording genuine completion of real
  work done against a UMR, once it actually finishes." No row was hand-set to a
  status; both writes went through the real CLI/registrar.)

## SPEC premise, re-verified live

The SPEC (evidence gathered 2026-08-06 11:25 UTC) cited: trailing-24h owner-dispatch
set total=141, closed=38 (27.0%), with 29 rows stuck in `status=dispatched`, and named
`UMR-20260806-103954-6f42` (veridian-directive-engine.service enable) as proof that at
least one of those 29 was really done despite reading `dispatched`.

By the time this task actually ran (~23:50-23:53 UTC, **~12.5 hours later**), live
re-verification found the picture had already moved on substantially, independent of
anything this task did:

- **Zero rows anywhere in `status='dispatched'`** (global query, and within the
  `owner_dispatch_gateway`/trailing-24h scope specifically) at either the pre-sweep or
  post-sweep snapshot.
- `UMR-20260806-103954-6f42` itself: `generate_pm_report_v3.py`'s own dead-zone
  auto-remediation log shows it was **already reset** by a separate, independent
  mechanism (`reconcile_dispatched_dead_zone.py`'s auto-remediation path) at
  `2026-08-06T21:16:08.856367+00:00` -- *before this session started* --
  logged as `Auto-reset dead-zone dispatched row: UMR-20260806-103954-6f42
  (status=resolved)`. The row was then **reused** (the documented
  ON-CONFLICT UMR-reuse-on-resume behavior of `upsert_umr_task()`) for an
  unrelated task: at query time its `unit_name` was
  `veridian-worker@task-20260806-230700-pm-decision-falsify-owner-proposal-48-re.service`,
  `status='running'`, `ts_dispatched='2026-08-06T23:07:05Z'`, `last_heartbeat=NULL` --
  nothing to do with `veridian-directive-engine.service` anymore.

**Per SPEC Step 5**, this is reported as the real outcome rather than hand-edited:
the row this SPEC named as proof was not reconciled by `--reconcile-stale` in this
session because it was no longer in a reconcilable state by the time this session
ran -- it had already been handled by a different, independent, already-existing
automated mechanism roughly 2.5-2.75 hours earlier, and then recycled for new work.
This is not a defect in `--reconcile-stale` itself (that flag never had a chance to
see the row in the state the SPEC described); it is the SPEC's snapshot going stale
across a ~12.5 hour gap between report-generation and dispatch-execution, the same
class of live-state-drift documented elsewhere in this repo's own ACTIVE-CLAIMS
history.

## Step 2: `resource_governor.py --reconcile-stale` -- verbatim output

Dry run (no `--execute`):

```json
{"actions": [{"umr_id": "UMR-20260806-101302-65a0", "unit_name": "veridian-worker@task-20260806-091101-build-extend-calculation-track-engines.service", "reconciled_to": "completed", "decision": "would_reconcile"}, {"umr_id": "UMR-20260806-152231-965d", "unit_name": "veridian-worker@task-20260806-151345-critical-real-disk-exhaustion-root-files.service", "reconciled_to": "completed", "decision": "would_reconcile"}, {"umr_id": "UMR-20260806-152232-75d2", "unit_name": "veridian-worker@task-20260806-151402-real-disk-emergency-remediation-root-fil.service", "reconciled_to": "completed", "decision": "would_reconcile"}]}
```

Executed (`--execute`):

```json
{"actions": [{"umr_id": "UMR-20260806-101302-65a0", "unit_name": "veridian-worker@task-20260806-091101-build-extend-calculation-track-engines.service", "reconciled_to": "completed", "decision": "reconciled"}, {"umr_id": "UMR-20260806-152231-965d", "unit_name": "veridian-worker@task-20260806-151345-critical-real-disk-exhaustion-root-files.service", "reconciled_to": "completed", "decision": "reconciled"}, {"umr_id": "UMR-20260806-152232-75d2", "unit_name": "veridian-worker@task-20260806-151402-real-disk-emergency-remediation-root-fil.service", "reconciled_to": "completed", "decision": "reconciled"}]}
```

## Step 3: real per-row evidence (from `umr_tasks.reason`, written by the sweep itself)

| umr_id | unit_name | source_trigger | new status | evidence |
|---|---|---|---|---|
| UMR-20260806-101302-65a0 | veridian-worker@task-20260806-091101-...service | dispatch-tick:resume_interrupted_workers | completed | "reconciled by heartbeat sweep: unit ... inactive, last_heartbeat stale (>900s), real exit status=completed" |
| UMR-20260806-152231-965d | veridian-worker@task-20260806-151345-...service | dispatch-tick:resume_interrupted_workers | completed | same pattern, real exit status=completed |
| UMR-20260806-152232-75d2 | veridian-worker@task-20260806-151402-...service | dispatch-tick:resume_interrupted_workers | completed | same pattern, real exit status=completed |

**None of these 3 rows belong to `source_trigger='owner_dispatch_gateway'`** -- they
were dispatched by `dispatch-tick:resume_interrupted_workers`, a different real
source_trigger. This is disclosed explicitly because it explains why Step 4's
before/after numbers below are identical: the sweep did real, verified work, but none
of it fell inside the specific 24h owner-dispatch series the SPEC's percentage tracks.

## Step 4: real trailing-24h owner-dispatch numbers, before vs after

Both captured via the real, unmodified `generate_pm_report_v3.py`
(`get_owner_dispatch_umr_status_counts()`, `source_trigger='owner_dispatch_gateway'`,
`ts_submitted >= now-24h`) -- the same function/query the cited PM report contract
(UMR-20260806-042531-be9c) uses.

**Before** (2026-08-06T23:51:2xZ, pre-`--execute`):
```
{'completed': 128, 'completed_unmerged': 1, 'failed': 48, 'killed': 18, 'queued': 6, 'rejected_duplicate': 9, 'running': 24}
total=234  closed=128  pct=54.7
```

**After** (2026-08-06T23:5xZ, post-`--execute`):
```
{'completed': 128, 'completed_unmerged': 1, 'failed': 48, 'killed': 18, 'queued': 5, 'rejected_duplicate': 9, 'running': 25}
total=234  closed=128  pct=54.7
```

Unchanged, for the real reason given in Step 3 (the 3 rows this sweep reconciled were
not in the `owner_dispatch_gateway` series). The `queued: 6->5` / `running: 24->25`
drift between the two snapshots is unrelated background dispatch-tick activity in the
~2 minutes between captures, not this sweep.

Separately, note the SPEC's original **141/38/27.0%** figure (captured 11:25 UTC) vs.
the **234/128/54.7%** figure live at execution time (23:5x UTC) -- a real, large,
already-happened improvement over the ~12.5h gap, driven by the normal
dispatch-tick/dead-zone-reconciliation pipeline running continuously in the
background, not by this task.

## Honest summary

- Real child UMR minted and closed via the canonical registrar: `UMR-20260806-235333-3587`.
- Real sweep run, both dry-run and `--execute`; 3 real rows genuinely reconciled to
  `completed` with real systemd-derived evidence recorded on each row.
- The specific proof-row the SPEC named (`UMR-20260806-103954-6f42`) was independently
  already resolved by a separate live mechanism before this session started, then
  reused for unrelated work -- reported as such per Step 5, not hand-edited.
- The owner-dispatch-gateway 24h closure percentage this SPEC was chasing did not move
  as a result of this sweep (0% attributable), because 0 rows in that specific series
  were in a reconcilable stale state at execution time -- not because the sweep is
  broken, but because the SPEC's 11:25 UTC snapshot had already been overtaken by
  ~12.5 hours of real, ongoing background reconciliation by the time this task ran.
