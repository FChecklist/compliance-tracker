# PROGRESS -- task-20260806-142152-ocid-020-category-19-backup-and-recovery

OCID-020 GTM certification category_index=19 ("backup and recovery testing"),
parent UMR-20260802-165606-4413. Child UMR minted this task:
UMR-20260806-142923-75c7.

## Completed
- [x] Minted child UMR `UMR-20260806-142923-75c7` under parent
      `UMR-20260802-165606-4413` through the canonical registrar
      (`/opt/veridian/scripts/superboss-register.py`'s own
      `upsert_umr_task()`/`_write_lock()`, imported as a module the same way
      `gtm_write_category_result.py` already does -- `upsert_umr_task()` is
      not exposed as a bare CLI subcommand, so this is the real canonical
      path, never raw SQL).
- [x] Investigated the SPEC's premise (superboss-register.sqlite backup 64.3h
      stale against a 48h bar) against live state and found it **already
      false** at task start: `gtm_certification_categories` row 19 already
      showed `passed=1`, `validated_at=2026-08-06T10:01:38Z`, with a fresh
      08:00:15Z-mtime dated backup -- a concurrent session had already found
      and fixed the real root cause ~4.5h before this task began.
- [x] Confirmed no `sqlite-daily`-named systemd user timer/service exists
      (`systemctl --user list-timers --all`, `crontab -l` empty per the
      2026-07-29 cron-consolidation retirement note) -- the actual backup
      mechanism is `health-check-15min.py`'s `check_db_integrity_and_backup()`,
      run every 15 min via `veridian-cron-health-check-15min.timer`.
- [x] Found the real, two-layer root cause (already fixed by others, verified
      independently here, not re-litigated):
      1. `superboss-register.sqlite`'s `file_inventory` table was corrupted,
         which blocked `check_db_integrity_and_backup()`'s whole-database
         `PRAGMA integrity_check` gate for ANY backup at all since
         2026-08-03. Repaired 2026-08-06T04:38-04:43Z (evidence: the live
         `file_inventory_corrupted_orig_20260806T044301Z` quarantine table +
         `superboss-register.sqlite.20260806T043818Z/T044325Z-pre-*-fresh.bak`
         snapshots still on disk). Verified live: `PRAGMA integrity_check`
         against the current production DB returns `ok` right now.
      2. Even once integrity_check passed, that function's backup step used
         an unsafe raw file copy against a live, concurrently-written DB --
         itself capable of silently producing a corrupt `.bak` (confirmed
         live under UMR-20260806-075605-f9da: a raw copy taken under
         concurrent writers produced "invalid page number"/"wrong # of
         entries in index" corruption even when the source integrity_check
         passed). Fixed by switching to SQLite's own online backup API
         (`sqlite3.Connection.backup()`), commit
         `53399faf8aa7d6c82a99860b1e32be46219276c0`, merged to
         `veridian-scripts` `main` as
         `fc7afbb81cd205e703c9e2341d4ba59c6ba7c4c0` via PR #144 at
         2026-08-06T08:08:01Z.
      Confirmed the fix is genuinely live on disk: current
      `/opt/veridian/scripts` checkout's `health-check-15min.py` is
      byte-identical to `fc7afbb8`'s version (`git diff` empty), even though
      the working tree currently sits on a later branch
      (`fix/build-lock-liveness-guard-deploy-proof-umr20260806124537-9f47`)
      that descends from `main` post-merge.
- [x] Re-ran the real category 19 check script
      (`python3 gtm_check_backup_recovery_testing.py`) fresh, live, at
      2026-08-06T14:29:27Z: **PASS** -- `superboss-register.sqlite` backup
      6.49h old (1,614,348,288 bytes), `credit-ledger.sqlite` backup 14.48h
      old (2,887,680 bytes), both non-zero and well under the 48h bar.
      Wrote the result back into `gtm_certification_categories` (row 19
      only, no other category row touched) via the canonical writer
      `gtm_write_category_result.py`, never raw SQL.
- [x] The check script's own writer call does not pass
      `--fix-commit`/`--fix-file-path`/`--fix-pr-number`, so it nulled those
      three columns on row 19 as a side effect of the re-run. Immediately
      restored them with a second `gtm_write_category_result.py` call citing
      the real fix (commit `fc7afbb8`, `health-check-15min.py`, PR #144) so
      the re-check didn't erase already-correct governance provenance.
- [x] Recorded the real (OCID, UMR, PR/commit/file) linkage via
      `insert_ocid_artifact_link()` and marked child UMR
      `UMR-20260806-142923-75c7` `status='completed'` with full real
      findings, commit SHAs, PR number/URL, and evidence in its
      `outputs_json`/`reason` -- through the canonical registrar, never raw
      SQL.
- [x] Did not force an unnecessary extra manual backup -- the existing
      08:00:15Z dated backup is already well within the 48h bar and was
      produced by the now-fixed automated mechanism, not manually; forcing a
      redundant ~1.8GB online backup of a live, actively-written database
      right now would have been pure resource cost with no evidence value.
- [x] Left the prior sibling child UMR's artifact
      (`UMR-20260805-165909-4d8b`'s standalone `sqlite_daily_backup.py` +
      systemd unit, veridian-scripts PR #78, branch
      `feat/ocid020-sqlite-daily-backup-generator-umr20260805165909-4d8b`,
      still open/unmerged) untouched -- it is now superseded by the simpler,
      already-merged `health-check-15min.py` fix and is not required for
      category 19 to genuinely pass, but closing/merging it is out of this
      task's scope.
- [x] Did not touch any `gtm_certification_categories` row other than 19.

## Remaining
- [ ] None for this task. Category 19 is genuinely, currently `passed=1`
      with fresh, real, live-verified evidence and correct fix provenance.
      Open item for a *future*, separately-scoped task: decide whether
      veridian-scripts PR #78's now-superseded standalone generator should
      be closed or merged as a defense-in-depth supplement -- not attempted
      here (out of scope, no PM authorization for that decision in this
      SPEC).
