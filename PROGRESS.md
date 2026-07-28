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
- [x] Added `engine_track TEXT` column to `sap_reports` (was missing;
      ALTER TABLE via sqlite3/python3).
- [x] Populated `engine_track` for all 80 rows from real calculation_logic
      content (not guessed) -- classification rule applied per row:
      `calculation` = pure deterministic formula/aggregation/read, no
      persisted state machine or SLA is the report's real subject
      (derived statuses recomputed fresh from quantities/dates each run,
      e.g. PO status from ordered-vs-received qty, still count as
      calculation); `workflow` = the report's core subject is a persisted
      state machine/status pipeline read directly from a state-tracking
      object with little or no real formula (e.g. SAP order system-status
      list, SD document-flow tracing, bank-statement match/no-match
      queue); `hybrid` = real calculation formulas applied on top of live
      stage/status/SLA state (e.g. CRM weighted-pipeline value, AR
      dunning-level escalation gated by elapsed days, AP approval-status
      net-payment-due, PS system-status + budget variance).
      Result: **67 calculation / 9 hybrid / 4 workflow** (sums to 80).
      Full per-row breakdown is in the classification script's
      `CLASSIFICATION` dict (see commit).
- [x] Verified: 0 rows with NULL engine_track; category counts cross-checked
      against the manually-built classification list.

## Remaining
- [ ] None -- task complete. The sqlite file lives outside this git repo
      (`/opt/veridian/ai-os/memory/sap_mapping.sqlite`, shared non-git infra
      state) so there is no PR for the data mutation itself; this
      PROGRESS.md update and the earlier ACTIVE-CLAIMS.yaml commit are the
      only git-tracked artifacts for this task. A pre-change backup copy
      (`sap_mapping.sqlite.bak-pre-engine_track-20260728`) was left next to
      the live file as a safety net given this directory's history of
      concurrent-write corruption.

## Note on the "87" in the spec
The spec said "87 rows" but the real table has 80. All 11 SAP modules'
`ingest_log` rows are marked `DONE` (last one 2026-07-28T10:16:20, CRM),
so this isn't a partially-finished ingest -- 80 appears to be the true,
complete count. Proceeded with the real data rather than blocking on the
discrepancy or fabricating 7 extra rows.
