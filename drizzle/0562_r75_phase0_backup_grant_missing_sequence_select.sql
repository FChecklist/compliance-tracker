-- R75 Phase 0 (Z0-02): a full pg_dump against this database as app_runtime
-- (the application's own runtime role, already SELECT-privileged on every
-- table in compliance/platform) failed with "permission denied for sequence
-- cc_results_result_id_seq" -- pg_dump needs SELECT on a sequence OBJECT
-- itself (not just its owning table) to capture last_value/is_called for a
-- faithful restore. Found 11 platform-schema sequences missing this grant,
-- pre-existing and not caused by this migration -- app_runtime already has
-- full read/write access to every row these sequences back, this closes a
-- narrow gap in the sequence-object grant specifically, required for backup
-- tooling to function. compliance.asset_id_seq already had the grant; these
-- 11 did not, for no functional reason found (no special-case comment
-- anywhere referencing them).
GRANT SELECT ON SEQUENCE platform.claude_instructions_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.claude_log_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.code_facts_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.crr_queue_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.crr_selfaudit_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.r49_watch_baseline_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.session_audit_r60_r67_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.source_reads_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.uat_fix_fix_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.uat_queue_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.uat_result_id_seq TO app_runtime;
