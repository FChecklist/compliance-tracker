# PROGRESS -- task-20260807-071550-dynamic-concurrency-cap-implementation-p

## Completed
- [x] Verified SPEC premise live: `FChecklist/veridian-scripts` PR #9 was merged
      2026-08-02T03:27:52Z (mergeCommit `306dd76`) but its `compute_dynamic_concurrency_cap()`
      commit (`7d5e8ec`) was **explicitly reverted the same day** by commit `c35987c`
      (UMR-20260801-190119-ff34, real Owner directive after live evidence: swap hit 100%
      exhaustion with only 3 of the then-5-slot cap running). Final, current production design
      in `dispatch_core.py` (confirmed live, `c16f456` on top, 2026-08-06) is a **fixed**
      `CONCURRENCY_CAP` (env-overridable via `VERIDIAN_DISPATCH_CONCURRENCY_CAP`, default 5)
      plus an independent real-time `has_resource_headroom()` veto -- both must pass in
      `has_free_slot()`. `compute_dynamic_concurrency_cap()` does not exist in production.
- [x] Confirmed this SPEC (claiming the dynamic-cap version is current, PR #9 "never live-edited",
      and "independent safety audit dispatched -- not yet merged pending that verdict") is a
      **stale/false premise** -- the same UMR (`UMR-20260801-173320-f35a`) this task's own
      briefing cites was already dispatched once before (task-20260807-062751), reached the
      identical conclusion, and closed via `FChecklist/compliance-tracker#1022` (docs-only,
      currently OPEN/MEDIA-mergeable, unmerged for reasons unrelated to this task -- see
      `veridian-branch-protection-self-approval-deadlock-active` memory).
- [x] Declined to re-implement `compute_dynamic_concurrency_cap()`. No code change made in either
      `veridian-scripts` or `compliance-tracker`. No new PR opened -- PR #1022 already covers
      this exact closure and opening a second one would just duplicate it further.
- [x] Checked `ai-os/boss/ACTIVE-CLAIMS.yaml` for this UMR: no conflicting active claim found.

## Remaining
- [ ] None -- this sub-task is closed as a duplicate dispatch of already-resolved work. If a
      genuinely new Owner directive supersedes UMR-20260801-190119-ff34's revert, that would be
      a fresh task, not a re-run of this one.
