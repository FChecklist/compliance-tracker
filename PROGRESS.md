# PROGRESS -- task-20260806-142206-fix-real-umr-tasks-status-equals-failed

## Completed

- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, `CONSTITUTION.yaml` context per protocol; confirmed scope is
      operational (`/opt/veridian/scripts` + live `superboss-register.sqlite`), not a compliance-tracker
      code change -- see [[veridian-scripts-separate-repo-live-checkout]].
- [x] Located the real umr_tasks `status='failed'` rows in the trailing-24h `owner_dispatch_gateway` set
      (read-only sqlite query, `source_trigger='owner_dispatch_gateway' AND status='failed' AND
      ts_submitted >= now-24h`) -- found **42** current rows, not 7 (the SPEC's "seven" count was a
      stale snapshot; the live set had grown since the PM investigation ran).
- [x] Independently re-verified the SPEC's two named examples
      (`task-20260806-065109-test`, `task-20260806-041150-corruption-recovery-unblocked`) against their
      real `task.yaml` and `gh pr view` state, and found **the SPEC's own characterization of both was
      wrong**:
      - `task-20260806-065109-test`: SPEC claimed "genuinely complete, zero remaining steps." Real
        task.yaml's own final checkpoint note says the opposite -- PR #127 merge FAILED, independently
        re-confirmed `state=CLOSED, mergedAt=null`.
      - `task-20260806-041150-corruption-recovery-unblocked`: SPEC claimed "genuinely never started."
        Real task.yaml shows it produced a real PR #113, reviewed and rejected. The underlying
        corruption goal IS moot (Owner fixed it independently, confirmed via `PRAGMA integrity_check`),
        but the task did start.
- [x] Found the real root cause: a prior investigation (UMR-20260806-081403-ebd3 -- the same one that
      landed the `task.yaml`+`gh` cross-check fix in `resource_governor.py`'s
      `backfill_null_heartbeats()`/`_forward_progress_decision()`, veridian-scripts PR #148) had already
      gathered real per-row evidence for exactly 8 rows (the SPEC's "seven" plus one already-correct
      `completed` row) and recorded a `corrected_status` in each row's own `metadata_json` -- but nothing
      ever executed the second half: writing that correction back to the real `status` column.
- [x] Wrote, tested (4/4 real isolated-temp-DB unit tests passing), committed, and pushed the canonical
      correction script `apply_owner_dispatch_status_corrections.py` to `FChecklist/veridian-scripts`
      (writes ONLY via `update_umr_task()`, never raw SQL; default dry-run, `--apply` to write,
      idempotent) -- opened as
      [veridian-scripts#178](https://github.com/FChecklist/veridian-scripts/pull/178).
- [x] **Ran the canonical script live against production** `superboss-register.sqlite`
      (`--apply`), correcting the 5 genuinely-mislabeled rows, each citing its own real,
      already-verified evidence:
      | UMR | before | after | real evidence cited |
      |---|---|---|---|
      | UMR-20260805-034917-33a9 | failed | running | task.yaml blocked; credit-accountant human-review gate |
      | UMR-20260805-084033-d904 | failed | running | task.yaml blocked; real pushed merge commit `cc5dea73` (independently re-verified against task-20260805-134812-merge-ocid-021-own-real-registration-pr's own task.yaml -- SPEC's own cited example) |
      | UMR-20260805-084223-3ad7 | failed | running | real PR approved/CI-green, blocked by compliance-tracker's real no-second-reviewer gate (OCID-070) |
      | UMR-20260805-084255-3a74 | failed | running | PR #910 genuinely merged; blocked afterward only by credit-accountant gate |
      | UMR-20260805-130213-d627 | failed | running | real PR #965 approved/CI-green; tier2 requires real Owner sign-off |
- [x] Re-queried live DB post-apply: all 5 confirmed at `status='running'`; re-ran the script dry-run,
      confirms 0 rows pending (idempotent).
- [x] The two SPEC-named rows (`test`, `corruption-recovery-unblocked`) were **already** correctly
      `status='rejected_duplicate'` (matching their own already-recorded `corrected_status`) from the
      same prior investigation -- no further status write needed; SPEC's `completed`/`superseded`
      characterization for those two does not match real evidence (see above), documented honestly
      rather than forced through.

## Remaining

- [ ] Watch veridian-scripts#178 CI and merge once green (no dedicated human reviewer exists on that
      repo either -- same OCID-070 gap as compliance-tracker; may need the same autonomous-merge path
      per the 2026-07-31 full-autonomy directive once Superboss review passes).
- [ ] No compliance-tracker code change is needed for this task -- root cause and fix live entirely in
      `FChecklist/veridian-scripts` (`resource_governor.py`'s cross-check logic already fixed in PR #148;
      this task's own gap was the missing "apply the already-computed correction" step, now closed by
      PR #178 and the live `--apply` run above).
