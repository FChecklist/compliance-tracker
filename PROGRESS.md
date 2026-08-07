# PROGRESS -- task-20260807-002908-pm-overrides-a-false-positive-credit-acc

PM override dispatch. Reuses child UMR-20260806-182453-702a from blocked
task-20260806-205209 (no new UMR minted). Scope: FIX
`generate_platform_completion_checklist.py` (`/opt/veridian/scripts`,
`FChecklist/veridian-scripts`) IN PLACE -- no new/parallel script. DONE.

Note: SPEC cited UMR-20260806-042531-be9c as the child UMR; live DB check
showed that UMR is unrelated (a failed backfill-reconciliation row from a
different task). The real, correct child UMR for this blocked task is
UMR-20260806-182453-702a (confirmed via task.yaml/PROGRESS.md of
task-20260806-205209 and ai-os/boss/ACTIVE-CLAIMS.yaml history). Proceeded
with the real one; documented the discrepancy rather than silently going
along with the wrong ID.

## Completed
- [x] Registered active claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`, committed+pushed
- [x] Located blocked task-20260806-205209 + its real child UMR-20260806-182453-702a
- [x] Found prior invocation of that task had ALREADY root-caused + built a fix
      (uncommitted, isolated worktree `/opt/veridian/scripts` branch
      `fix/checklist-metric-determinism`) before hitting the credit-accountant
      rejection -- reused/verified that work, did not rebuild from scratch
- [x] Root-caused the DENOMINATOR drift (already found by prior invocation,
      re-verified live): `_list_scripts()`/`_list_test_files()` glob()'d the
      live, shared `/opt/veridian/scripts` checkout directly, picking up
      other concurrent sessions' uncommitted/in-flight `.py` files.
- [x] Root-caused the NUMERATOR-TO-ZERO collapse (0/154 reading), NEW work
      this session -- reproduced directly, not theorized: a 2-file local
      pytest repro (1 valid test + 1 file with a real `SyntaxError`) proved
      pytest aborts the **entire** run with `returncode=2` ("Interrupted: N
      errors during collection") the instant even one requested file fails
      to collect. The old `_run_pytest()` classification only special-cased
      explicit `FAILED`/`ERROR ...` lines for the specific failing file, then
      fell back to `"error"` for every *other* requested file whenever
      `returncode not in (0, 1)` -- so one transient/incomplete concurrently-
      written file was enough to zero the whole Scripts numerator across all
      154 scripts, a real invocation failure, not a real loss of coverage.
- [x] Confirmed the existing `git archive HEAD` snapshot fix (script/test
      discovery + pytest all run against an isolated temp-dir snapshot, never
      the live working tree) structurally fixes BOTH mechanisms: git archive
      only ever extracts fully-committed atomic blobs, so a concurrent
      session's mid-write/untracked file can never appear in the snapshot at
      all, for either listing or pytest collection.
- [x] Incidental finding while proving the fix, NOT in original scope, fixed
      minimally because it blocked any full run: `superboss-register.sqlite`
      has real, live corruption -- `PRAGMA integrity_check` independently
      reproduced "Rowid ... out of order" (2 b-trees) and a wrong index entry
      count on `idx_wiring_registry_source_system`, persisted across 3 real
      re-checks over ~1 minute (not transient). This raises plain
      `sqlite3.DatabaseError`, which the script's existing
      `except sqlite3.OperationalError` clauses do NOT catch (`OperationalError`
      is `DatabaseError`'s own subclass, not an ancestor -- verified via
      `OperationalError.__mro__`), crashing the whole script on any
      corrupted-table read. Broadened the 4 existing per-table/per-query
      except clauses (same pattern already in the file) from
      `OperationalError` to `DatabaseError` so one corrupted table degrades
      to `complete_and_tested=False` instead of taking the entire run down.
      Did NOT attempt to repair the corruption itself -- flagged here as a
      separate, real, unactioned finding that needs its own PM
      decision/escalation; out of this override's scope.
- [x] Ran the fixed generator 3 consecutive times with real pytest (NOT
      `--skip-tests`). Real verbatim summary line each run:
      run 1: `{"git_head": "7f44e242cf4313a1c251004de406742cf8d4cfc2", "scripts": "42/150", "tables": "36/46", "search": "10/11"}`
      run 2: `{"git_head": "7f44e242cf4313a1c251004de406742cf8d4cfc2", "scripts": "42/150", "tables": "36/46", "search": "10/11"}`
      run 3: `{"git_head": "7f44e242cf4313a1c251004de406742cf8d4cfc2", "scripts": "42/150", "tables": "36/46", "search": "10/11"}`
      (git_head is the pre-rebase worktree HEAD at the time these 3 proof
      runs were taken, before rebasing the fix commit onto latest origin/main
      for the PR)
      Isolating just the `scripts` JSON payload per run and hashing:
      `md5sum` identical across all 3 (`4cb0e726712dd4c2a9eb286c25981c24`) --
      byte-identical, including per-script `tests_pass`/`complete_and_tested`
      fields and the real pytest result set (`2 failed, 543 passed` every
      run, same 2 failing files each time). Only the Tables/Search sections'
      *content* (not their totals) drifted between runs, and only via the
      live `actions` table's own real `row_count` (29530 -> 29534 -> 29542,
      genuinely climbing from real concurrent writes) and its FTS shadow's
      `hits` count -- this is the exact "expected variance from real DB
      writes" the module docstring already documents as correct, not a
      recurrence of the instability being fixed.
- [x] Real true current numbers (post-fix, post-rebase-onto-main): Scripts
      42/150, Tables 36/46, Search 10/11.
- [x] Opened PR on `FChecklist/veridian-scripts`: #238
      (https://github.com/FChecklist/veridian-scripts/pull/238) -- did NOT
      push to the live checkout directly. No CI/branch-protection configured
      on this repo (private repo, GitHub API confirms no Pro plan -> no
      branch-protection feature; no `.github/workflows` present) so merged
      directly once mergeable, per Rule 6's actual mechanism (PR gate, no
      bypass of a check that doesn't exist here). Merge commit:
      `726f7c433561bc35c09084ec8a7d2aaf0d984ab9`.
- [x] Wrote real evidence into UMR-20260806-182453-702a via
      `mark-umr-terminal --status completed --commit-sha
      726f7c433561bc35c09084ec8a7d2aaf0d984ab9 --pr-number 238 --repo
      veridian-scripts` (verified as a real ancestor of origin/main before
      marking). Reason field carries the full root-cause + proof text
      verbatim, no narration beyond what's independently verifiable from the
      commands run.
- [x] Confirmed: did NOT mark the Owner stop-work order
      (task-20260806-165921, already `status: completed` independently)
      complete a second time, did NOT touch/resume OCID-020, the Z.AI track,
      or any unrelated PR work.

## Remaining
- [ ] None -- task complete. Closing ACTIVE-CLAIMS entry and doing final commit+push.
