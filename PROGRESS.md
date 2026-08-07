# PROGRESS -- task-20260807-065748-fix-worker-entrypoint-sh-479-hardcoded-g

## Completed
- [x] Investigated the live, actually-executed script (`/opt/veridian/scripts/worker-entrypoint.sh`,
      separate `FChecklist/veridian-scripts` repo -- the one systemd's
      `veridian-worker@.service` actually runs, `ExecStart=/opt/veridian/scripts/worker-entrypoint.sh %i`).
      Found the hardcoded-gate-name bug at its own line 479 was **already fixed**
      and merged to that repo's `main` (commit `e1aa1f2`, "recover: real undocumented
      local hotfixes found on live server, pre-PR20" -- confirmed via
      `git merge-base --is-ancestor e1aa1f2 origin/main` = YES). No new fix needed
      on the live/executing copy -- this half of the SPEC was already done.
- [x] Found compliance-tracker carries its own mirror copy at
      `ai-os/scripts/worker-entrypoint.sh`, last synced at PR #569 (2026-07-26)
      and stale ever since (354 lines vs. 683 live lines -- missing ~330 lines of
      later changes). This mirror still had the *exact* pre-fix bug: `--search-terms
      "quality gate auto-fix retry"` was a hardcoded literal identical for every
      task fleet-wide, so `credit-accountant.py`'s `check_existing_capability()`
      system_index lookup always matched ~60 unrelated generic entries regardless
      of what actually failed -- false-positive-rejecting every auto-fix attempt.
      This is the plausible major contributor to the 484-blocked bucket flagged by
      the main session under the existing 800-task audit
      (`UMR-20260801-153900-9100` -- **not duplicated here, only linked**).
- [x] Applied the same fix pattern already proven live to the compliance-tracker
      mirror: compute `FAILING_GATES` from the real `quality-gate-N.json` (sorted,
      comma-joined names of gates where `passed` is falsy, `"unknown"` fallback),
      and pass it into `--search-terms "quality gate auto-fix retry: $FAILING_GATES"`.
- [x] `bash -n ai-os/scripts/worker-entrypoint.sh` -- syntax OK.
- [x] Verified the parsing logic against a synthetic quality-gate JSON with 2
      failing gates (`lint`, `typecheck`) and 2 passing (`install`, `build`):
      output was `lint,typecheck` -- real gate names surface correctly instead of
      a placeholder.
- [x] Committed + pushed, opened PR against compliance-tracker.

## Remaining
- [ ] None -- fix landed on the mirror; live/executing copy already had it.
