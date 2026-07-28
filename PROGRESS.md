# PROGRESS -- task-20260728-123644-classify-87-sap-reports-into-engine-trac

## Completed
- [x] Located real sap_mapping.sqlite: NOT in this repo, lives at
      `/opt/veridian/ai-os/memory/sap_mapping.sqlite` (shared, non-git
      infra state). Actual row count is **80**, not 87 -- all 11 SAP
      modules' ingest_log entries show status DONE; treating 87 as a stale
      spec estimate, proceeding with the real 80 rows.
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`, committed + pushed
      (commit 2fb15cff).
- [x] Took a timestamped backup copy of the sqlite file before any schema
      change (`sap_mapping.sqlite.bak-pre-engine_track-20260728`) --
      this directory has a history of concurrent-write corruption
      (see sibling `superboss-register.sqlite.CORRUPTED-*` files).
- [x] Read all 80 rows' real `calculation_logic` content in full.

## Remaining
- [ ] Add `engine_track TEXT` column to `sap_reports` (if missing).
- [ ] Populate `engine_track` for all 80 rows from real calculation_logic
      content (not guessed).
- [ ] Verify every row populated, no NULLs.
- [ ] Final PROGRESS.md update + commit/push.
