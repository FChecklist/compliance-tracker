# PROGRESS -- task-20260802-055212-fix-worker-entrypoint-sh-479-hardcoded-g

Target file lives in a separate repo, `FChecklist/veridian-scripts`
(checked out live at `/opt/veridian/scripts`, not part of compliance-tracker)
-- PR opened there, not on compliance-tracker, since that's where the fix
actually applies. Linked, not duplicated: this closes the specific
`worker-entrypoint.sh:479` root cause flagged as a plausible major
contributor under the existing 800-task audit UMR-20260801-153900-9100.

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (this task is
      scoped to `/opt/veridian/scripts/worker-entrypoint.sh` only, a
      different repo than compliance-tracker -- no in-repo file collision
      possible, registering for visibility per protocol anyway)
- [x] Found the bug: `worker-entrypoint.sh`'s quality-gate auto-fix loop
      called `credit-accountant.py propose --search-terms "quality gate
      auto-fix retry"` -- a hardcoded literal identical for every task
      fleet-wide, regardless of which gate(s) actually failed
- [x] Confirmed a fix was already staged uncommitted in the live
      `/opt/veridian/scripts` checkout (from an interrupted prior attempt on
      this same task -- PROGRESS.md had been reset but the actual code edit
      survived in the shared, non-worktree live directory). Reviewed it and
      it is correct: computes `FAILING_GATES` from the real
      `quality-gate-N.json` (sorted, comma-joined names of gates where
      `passed` is falsy, `unknown` fallback), appends it to the
      `--search-terms` string
- [x] `/opt/veridian/scripts` is the live shared checkout other sessions
      also have uncommitted WIP in (`quality-gate.sh`,
      `superboss-register.py` -- unrelated to this task, left untouched).
      Extracted *only* the worker-entrypoint.sh diff into an isolated git
      worktree (`fix/worker-entrypoint-real-failing-gate-names` branch) so
      this PR doesn't bundle another session's in-flight work
- [x] Verified: ran the exact `FAILING_GATES` extraction command from the
      patched script against 4 real `quality-gate-*.json` files pulled from
      actual blocked tasks under `ai-os/tasks/*` (including
      `task-20260801-153920-audit-and-clean-800-ai-os-task-records`, part of
      the linked 800-task audit) -- real gate names (`build,lint` / `build`)
      now surface instead of the old constant string. Confirmed the
      `unknown` fallback still holds for a missing/corrupt JSON. `bash -n`
      syntax-checked the patched file clean.
- [x] Committed + pushed `fix/worker-entrypoint-real-failing-gate-names` to
      `FChecklist/veridian-scripts`, opened PR

## Remaining
- [ ] None -- PR open, awaiting CI/merge
