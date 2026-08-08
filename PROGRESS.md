# PROGRESS -- task-20260808-145709-build-task-gateway-py-audit-24-points

Governing chain: UMR-20260806-171945-5767 / UMR-20260808-145030-f3d1 (re-dispatch of
UMR-20260808-122929-bc77; prerequisite UMR-20260808-121334-e122 independently re-verified
merged: veridian-scripts PR #278, commit bc14a21, merge 5537b6d on origin/main).

Real work landed in **veridian-scripts** (separate live-checkout repo, not this one):
https://github.com/FChecklist/veridian-scripts/pull/280 (branch `feat/audit-24-points-task-gateway`, OPEN)

## Completed
- [x] Independently re-verified stop-work-order/gate status live (resource_governor.py
      --check-task-start-gate returned blocked=false) before starting.
- [x] Registered ACTIVE-CLAIMS entry (this repo, commit 40ba24efc, pushed).
- [x] Point 19: ported `_record_master_issue_if_new` + its 2 real call sites forward from the
      unmerged, stale `feat/master-issue-tracker-add-issue-cli` branch into current
      `resource_governor.py` (hand-ported, not a raw merge -- that branch predates main's
      STOP_WORK_ORDER_TRUNK_REF hardening). Live smoke-tested (dedup-by-issue_id confirmed).
- [x] Point 14/16: new `detect_stale_umr_rows()` (90min queued+ts_dispatched-NULL / 45min
      running-no-heartbeat) + `--umr-staleness-scan` CLI flag, wired into the EXISTING
      `resource_governor_tick_loop.sh` 30s loop (confirmed exactly one `sleep 30`, no new timer).
- [x] Landed the already-uncommitted `list-issues --linked-umr-id` filter found live in the
      working tree at dispatch time (addendum UMR-20260808-123107-875a WIP).
- [x] New `governance_cycle_log` table + `log-governance-event`/`list-governance-events` CLI
      (superboss-register.py), backing Points 2/8/9. Both real canonical query-path callers
      (`task-gateway.py status`, `resource_governor.py --query-umr`) now log real events.
- [x] `task-gateway.py audit-24-points` subcommand: all 12 real, deterministic boolean checks
      (points 2/4/8/9/12/14/16/17/19/20/22/23) implemented, each reusing existing logic where
      the spec required it (Point 12 -> umr_completion_percentage.py's `_parse_outputs()`,
      Point 14 -> `detect_stale_umr_rows()`, Point 19 -> `_record_master_issue_if_new`).
- [x] Persistence into master_issue_tracker (UMR171945-0001..0024) via `update-issue` CLI
      (never raw SQL), matching the exact contract `tests/test_audit24_master_issue_tracker_persistence.py`
      already proved.
- [x] Point 22 conservative auto-close scoped only to this governing UMR's own 24 rows.
- [x] Point 23 (Grafana) returns an honest FALSE with no fabricated placeholder -- Grafana was
      evaluated+rejected as software per PLATFORM_STRATEGY.md; documented the real Wave 38
      metric-alert-service.ts replacement.
- [x] Tests: `tests/test_audit_24_points.py` (new, end-to-end CLI run, real synthetic TRUE/FALSE
      cases, persistence roundtrip via `list-issues --linked-umr-id`) + landed
      `tests/test_audit24_master_issue_tracker_persistence.py`. 13/13 new tests pass. No
      regression in `tests/test_stop_work_order_gate.py` (11/11).
- [x] Committed + pushed (2 commits: 7f70543 prerequisites, 508d7c7 the subcommand+tests) and
      opened veridian-scripts PR #280.

## Remaining
- [ ] veridian-scripts PR #280 needs independent tier1 review + merge (this session cannot
      self-merge per Rule 6's PR/CI gate).
- [ ] Once merged, run `task-gateway.py audit-24-points` for real (no `--no-persist`) against
      live production `superboss-register.sqlite` to persist real current-state results into
      UMR171945-0001..0024 -- deferred to a follow-up cycle (budget-exhausted this session; the
      mechanism is proven end-to-end against a scratch DB, but a real production run + its own
      independent verification is real work that should not be rushed in the final minutes of a
      budget-constrained session).
- [ ] Point 4 will read FALSE until PR #280 merges (real, honest, self-correcting once merged).
