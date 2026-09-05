-- R75 Phase 0 (Z0-02) follow-up: migration 0562 used information_schema
-- .sequences to enumerate the gap, which silently omitted 4 more sequences
-- that DO exist and DO have the same missing-SELECT-for-app_runtime gap --
-- caught by re-querying with pg_catalog.pg_sequences (the complete,
-- authoritative view) after 0562's fix still left pg_dump failing on
-- cc_results_result_id_seq, which was never in 0562's list at all. Lesson
-- for this migration's own future readers: information_schema.sequences is
-- not a complete enumeration on this database; pg_sequences is.
GRANT SELECT ON SEQUENCE platform.cc_results_result_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.crr_baseline_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.ddl_capability_probe_id_seq TO app_runtime;
GRANT SELECT ON SEQUENCE platform.graph_edge_id_seq TO app_runtime;
