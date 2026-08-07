# PROGRESS -- task-20260806-234546-pm-approval-of-proposal-62-build-lock-co

Governing UMR: UMR-20260806-071025-1d28. SPEC: PM approval of proposal 62
(child UMR-20260806-121247-a93a, investigation UMR-20260806-120603-217b, PM
report contract UMR-20260806-042531-be9c), with two mandatory added
conditions (discrepancy root-cause gate, real throughput proof).

## Finding: the code implementation was already done ~11h before this task was
## dispatched (UMR-20260806-123316-cf9f, PR #172, merged). A live concurrent
## duplicate task (task-20260806-234542, PR #232) independently reached the
## same conclusion and covered the mandatory idempotency/no-spin test. This
## task's real, non-duplicate contribution is the throughput proof (condition
## 2) that was explicitly left open, plus a newly-discovered real defect.

## Completed

- [x] Reused UMR-20260806-121247-a93a as instructed (never minted a second
      UMR) -- confirmed via direct read-only `umr_tasks` query it has no row
      of its own; the real, queryable proposal record is `pm_decisions_pending`
      id=62 (`related_umr`=UMR-20260806-121247-a93a, status=`completed`).
- [x] Discovered and resolved a real duplicate-dispatch: sibling task
      `task-20260806-234542-pm-approval-of-proposal-62--implement-th` started
      4s before this one, for the same governing UMR, and opened PR #232
      (spin-bound idempotency test) before I finished investigating. Read its
      PR body/diff to avoid redoing its work; picked a disjoint contribution.
- [x] Condition 1 (discrepancy root cause): independently re-verified live
      (`systemctl --user show-environment` still shows
      BUILD_LOCK_WAIT_SECONDS=1700/GATE_STEP_TIMEOUT_SECONDS=1800 globally on
      this host's systemd --user manager, unchanged from row 62's own
      resolution ~11h45m earlier). PR #172's fix does not depend on the
      on-disk default at all (hardcoded 20s/700s, no `${VAR:-default}`
      indirection) so this pre-existing discrepancy cannot silently no-op it.
- [x] Condition 2 (real throughput proof): computed real before/after
      queued+completed counts from `pm_report_snapshots` for equal ~60min
      windows bracketing the real deploy cutover (`quality-gate.sh` mtime
      `2026-08-06T16:05:59Z`, derived from PR #172's real `mergedAt`). Result
      reported **honestly as flat/not-a-proven-win** at the aggregate level
      (17 vs 16 completions/hour), with two real confounds documented. Found
      more decisive direct evidence instead: 0 live lock waiters right now
      (was 4-of-5 chronic 582-1376s blocking) and 11 real
      `[quality-gate.sh] build lock contended` log lines in real task
      `worker.log` files since deploy, proving the new bounded-wait path is
      genuinely firing in production.
- [x] New real finding, left open per instructions rather than force-closed:
      9 of 11 (82%) of those real contention events hit a previously
      undiscovered defect -- `requeue-build-lock-contended` fails for any
      task whose `task_identity` never got a `umr_tasks` row (confirmed zero
      rows for all 9, not a status mismatch), falling through to a real gate
      failure caused purely by lock contention, not the task's own code.
      Directly the negative case condition 2 asked to be checked and reported
      honestly if found. Concrete recommended follow-up documented, not
      implemented here (scope/collision avoidance with the concurrent PR #232).
- [x] Step 3 (four safeguards): already implemented and live via PR #172 --
      independently read the live `quality-gate.sh` and confirmed all four:
      20s short wait, requeue-not-retry-loop, resume-marker gate-skip,
      4th-consecutive-loss 700s starvation-guard fallback.
- [x] Step 5 (real PR in veridian-scripts, no branch protection): opened and
      merged **PR #234** (`docs/proposal-62-throughput-proof-umr20260806121247-a93a`),
      merge commit `22471db46010dfbbf474213ed56425c2b7d510a7`, carrying
      `PROPOSAL_62_THROUGHPUT_PROOF_2026-08-06T2359Z.md` with the full
      evidence, real command outputs, and the honest non-success conclusion.
- [x] Step 6 (write real evidence into UMR-20260806-121247-a93a): the evidence
      lives in the merged PR #234 file above, which explicitly cites
      UMR-20260806-121247-a93a / pm_decisions_pending id=62 / UMR-20260806-123316-cf9f.
      Did **not** call `mark-umr-terminal` or `record-owner-proposal-completion`:
      row 62 is already `completed` (that call is an explicit documented
      no-op on an already-completed row) and UMR-20260806-121247-a93a has no
      `umr_tasks` row to meaningfully update -- both would be silent,
      honesty-breaking no-ops, not real writes. Same reasoning the sibling
      PR #232 independently used.

## Remaining

- [ ] None for this task's scope. Open follow-up recommended (not this
      task's job to implement): make `requeue-build-lock-contended` degrade
      gracefully, or ensure every task-creation path inserts a `umr_tasks`
      row, so the 82%-failure rate on the mandatory requeue safeguard closes.
