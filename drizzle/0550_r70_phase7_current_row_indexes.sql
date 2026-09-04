-- R70 Phase 7 (P7-03): partial indexes for current-row reads.
-- Never-delete + fast-read only works if current rows are indexed apart
-- from history. P6-01/P6-02 (EXPLAIN ANALYZE, live 2026-09-04) showed the
-- exact-tier read on compliance.memory_records and the seed-node lookup on
-- platform.graph_node both fall back to Seq Scan; this index targets the
-- current-row predicate these tiers filter on (effective_to IS NULL),
-- covering the columns actually scanned (org_id/scope for memory_records,
-- org_id/source_key for graph_edge's own instance-tier reads).
-- Instant at 0 rows (memory_records) and 945 rows (graph_edge).

CREATE INDEX IF NOT EXISTS idx_memory_records_current
  ON compliance.memory_records (org_id, scope_type, scope_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_graph_edge_current
  ON platform.graph_edge (org_id, source_key)
  WHERE effective_to IS NULL;
