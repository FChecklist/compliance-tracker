# PROGRESS -- task-20260731-074406-structural-duplicate-task-constraint-in

## Completed
- [x] Read real schema of knowledge_engine/work_items/instructions via PRAGMA table_info + direct data queries against the live DB (not guessed)
- [x] Determined real uniqueness key: bare UNIQUE(content_hash) is wrong (content_hash legitimately repeats -- 'n/a' placeholder x15, sha256-empty-string x13); real key confirmed against live data is (content_hash, artifact_path); found exactly 2 genuine pre-existing duplicates, zero false positives
- [x] Wrote /opt/veridian/scripts/migrate_2026-07-31_dedup_constraints.py -- idempotent, backs up DB, dedupes the 2 known duplicates, CREATE UNIQUE INDEX (no ALTER TABLE/rebuild), creates task_claims table
- [x] Updated superboss-register.py: _ensure_task_claims_table/claim_task_key/check_task_key + new claim-task-key/check-task-key subcommands; wrapped register_knowledge and upsert_knowledge_fragment INSERTs in try/except sqlite3.IntegrityError with structured duplicate signal
- [x] Updated task-gateway.py: cmd_start claims task_key atomically before veridian-task.py create (title-derived slug, same algorithm as real task_id); cmd_submit does read-only check-task-key advisory check
- [x] Wrote test_dedup_constraints_2026-07-31.py (standalone, python3-runnable, no pytest) -- proves both duplicate content_hash+artifact_path and duplicate task_key rejected via real sqlite3.IntegrityError against an isolated throwaway DB; exits 0
- [x] Ran migration live against real ai-os/memory/superboss-register.sqlite (0.4s under _write_lock flock, PRAGMA integrity_check=ok after, 365->363 rows, all other tables' row counts intact)
- [x] Committed to /opt/veridian/scripts (main-clean, commit 1cef3fe) -- no checkout/reset/pull used, edited live files in place
- [x] Appended status line to ai-os/KERNEL_CONSOLIDATION_STATUS.md and committed in ai-os tree (pre-workflow-main, commit eb03c34)

## Remaining
(none -- task complete; not self-audited per task's own constraint, needs a separate audit dispatch)
