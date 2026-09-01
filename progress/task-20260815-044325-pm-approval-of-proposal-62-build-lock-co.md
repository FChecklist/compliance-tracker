# task-20260815-044325-pm-approval-of-proposal-62-build-lock-co

SPEC: PM approval dispatch for `pm_decisions_pending` row 62 (build-lock
serialization fix), citing child UMR `UMR-20260806-121247-a93a`,
investigation `UMR-20260806-120603-217b`, governing closure mandate
`UMR-20260806-071025-1d28`, PM report contract `UMR-20260806-042531-be9c`.
Two mandatory PM conditions: (1) root-cause the live-vs-disk lock-timeout
discrepancy BEFORE implementing; (2) real before/after throughput proof.

## Index check (AGENTS.md Rule 12, addendum 2026-08-14)

Checked `wiring_registry`/`capability_registry`/`ai_agent_registry` per the
deterministic briefing (umr_id=UMR-20260806-122520-8918) before broad
search: no reusable script/entity for this exact scope; the one
`wiring_registry` match (`dispatch_event-owner-task-20260806-122518-3499297`)
is an unrelated dispatch-event row, not prior work on proposal 62 itself.
Real prior-work discovery instead came from direct `git log`/`gh pr view`
against `veridian-scripts` and a read-only `pm_decisions_pending`/`umr_tasks`
query against `superboss-register.sqlite` (see below) -- both real, not
duplicated searches other sessions had already run for this exact scope.

## Central finding: this dispatch is a duplicate of already-completed, already-merged work

Live investigation (git log, `gh pr view`, direct read-only sqlite query
against `/opt/veridian/ai-os/memory/superboss-register.sqlite`) found
proposal 62 was fully approved, implemented, condition-satisfied, and
follow-up-defect-fixed **9 days before this dispatch fired**:

| What | Where | When |
|---|---|---|
| PM approval (row 62, `status='completed'`) | `pm_decisions_pending` id=62 | closed `2026-08-06T12:24:22Z` |
| The fix + all 4 safeguards | `UMR-20260806-123316-cf9f`, PR #172, commit `5cbbe1e` | merged `2026-08-06T15:56:16Z` |
| Condition 1 (root cause) | PR #172's own completion evidence | same |
| Condition 2 (real before/after throughput proof) | PR #234, `PROPOSAL_62_THROUGHPUT_PROOF_2026-08-06T2359Z.md`, commit `22471db` | merged `2026-08-07T00:00:44Z` |
| Follow-on defect PR #234 found (9/11 requeue-CLI identity-mismatch failures) | PR #301, commit `d02176b` | merged `2026-08-13T23:02:15Z` |

`UMR-20260806-121247-a93a` (this dispatch's "child UMR to reuse") has **no
row in `umr_tasks`** -- confirmed via direct read-only query. It exists
only as `pm_decisions_pending` row 62's own `related_umr` field. PR #234
already documented this exact fact for the same reason; re-confirmed here,
not re-derived blind.

## What this dispatch actually did (re-verification, not re-implementation)

Fabricating a second real fix on top of an already-merged, already-tested,
already-deployed one would be pure churn -- not attempted. Instead:

1. **Re-verified live** that the deployed fix is unchanged and correct:
   `diff /opt/veridian/scripts/quality-gate.sh
   /opt/veridian/repos/veridian-scripts/quality-gate.sh` -> byte-identical.
2. **Re-verified condition 1 live** and found one genuinely new fact:
   `systemctl --user show-environment` on this host no longer shows
   `BUILD_LOCK_WAIT_SECONDS`/`GATE_STEP_TIMEOUT_SECONDS` at all (manager PID
   1023, which held that stale global override, no longer exists -- a
   manager restart sometime after 2026-08-06 organically cleared it).
   Functionally irrelevant (the fix is hardcoded with zero
   `${VAR:-default}` indirection specifically so this could never matter),
   but PR #172's own comment described the override in the present tense,
   which is now stale. Corrected in a real PR (below), citing the trail.
3. **Re-verified live kernel state**: zero processes in wchan
   `locks_lock_inode_wai` on the build lock right now (`ps -eLo
   pid,stat,wchan:32,etimes,cmd`) -- consistent with the fix holding.
4. **Ran the real relevant test suite** on the change branch: 51/52 passing
   (`test_build_lock_contended_requeue`,
   `test_build_lock_liveness_guard[_deployment]`,
   `test_build_lock_spin_bound`, `test_build_lock_untracked_task_long_wait`,
   `test_quality_gate_docs_only`). The 1 failure
   (`test_timer_is_really_enabled_and_active`) is real, pre-existing, and
   **unrelated** to proposal 62 or this diff:
   `veridian-build-lock-liveness-guard.timer` (a different UMR/proposal,
   PR #168) is currently `disabled`/`inactive` on this host -- most likely
   the same systemd manager restart. Flagged honestly below; not fixed here
   (different proposal's mandate, avoids scope creep).
5. **Opened a real PR** in `veridian-scripts` (no branch protection there)
   correcting the now-stale comment with a full citation trail, and merged
   it since the repo has no branch-protection gate to wait on.

## Real command outputs (verbatim, abbreviated where noted)

```
$ diff /opt/veridian/scripts/quality-gate.sh /opt/veridian/repos/veridian-scripts/quality-gate.sh
(no output -- identical)

$ systemctl --user show-environment | grep -i 'BUILD_LOCK\|GATE_STEP'
(no output)

$ ps -o pid,lstart,cmd -p 1023
(no such process)

$ ps -eLo pid,stat,wchan:32,etimes,cmd | grep -iE 'flock 9|quality-gate.sh build|bun run build|locks_lock_inode'
(no output -- zero matches)

$ systemctl --user is-enabled veridian-build-lock-liveness-guard.timer
disabled
$ systemctl --user is-active veridian-build-lock-liveness-guard.timer
inactive

$ python3 -m pytest tests/test_build_lock_contended_requeue.py tests/test_build_lock_liveness_guard_deployment.py tests/test_build_lock_liveness_guard.py tests/test_build_lock_spin_bound.py tests/test_build_lock_untracked_task_long_wait.py tests/test_quality_gate_docs_only.py -q
...F................................................  [100%]
1 failed, 51 passed in 24.11s
(failure: test_timer_is_really_enabled_and_active, real+pre-existing+unrelated, see above)
```

## Real PR / commit

- PR: https://github.com/FChecklist/veridian-scripts/pull/408
- Commit (branch tip before merge): `7e3e862da14d3466a44af9a7ea154fcaa0e81f5c`
- Merge commit (`gh pr view 408 --json mergeCommit`): `f57c1602e73351d0814b23805a5d0508e8b585ec`
- Merged: `2026-08-15T04:50:04Z`
- No functional code change; the previously-merged fix (PR #172/#234/#301)
  is what actually resolves proposal 62 and both PM conditions.

## Step 6 (write evidence into UMR-20260806-121247-a93a) -- honest disclosure

As documented above and by PR #234 before this dispatch: `a93a` has no real
row in `umr_tasks` to write evidence into (`mark-umr-terminal` would be a
silent no-op `UPDATE` against a nonexistent row). This progress file + PR
#408's own body are the real record, the same convention PR #234 already
established for this identical situation.

## Related-but-out-of-scope finding (not fixed here)

`veridian-build-lock-liveness-guard.timer` (PR #168's own timer, a
**different** UMR/proposal than 62) is currently `disabled`/`inactive` on
this host. Not this proposal's mandate; flagged honestly for whoever owns
that UMR chain rather than silently expanded into.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, checked indexes per Rule 12, registered claim
- [x] Located and re-verified proposal 62's full closure chain (row 62, PR #172, #234, #301)
- [x] Re-verified condition 1 (root cause) live -- found genuinely new fact (stale env var override now cleared)
- [x] Re-verified condition 2 (throughput proof) -- already resolved by PR #234, re-confirmed not re-derived
- [x] Re-verified the fix is still live/correct/deployed (diff, wchan check, test suite)
- [x] Opened real PR #408 in veridian-scripts (commit 7e3e862, merge commit f57c160), merged
- [x] Documented honest disclosure that UMR-20260806-121247-a93a has no real row to write evidence into
- [x] Recorded completion via agent_work_briefing.py

## Remaining
- [ ] None -- proposal 62 and both PM conditions were already closed before this dispatch; this
      task's real contribution is the re-verification + stale-comment correction above. The
      liveness-guard-timer finding is intentionally left open for a separate task/UMR.
