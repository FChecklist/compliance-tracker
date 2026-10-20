-- Perf (2026-10-20, Sumeet audit slowness investigation, PROJEXA_GO_LIVE_GAP_ANALYSIS_2026-10-19.md section 9).
-- Additive only: one partial index, CREATE INDEX IF NOT EXISTS, no table rewrite of data, nothing dropped or altered.
--
-- The portfolio / project-dashboard "latest BOQ per project" query
--   SELECT DISTINCT ON (project_id) project_id, id FROM compliance.construction_boqs
--   WHERE org_id = $1 AND project_id = ANY($2) AND status != 'superseded'
--   ORDER BY project_id, version DESC, created_at DESC
-- ran 3,093 times in pg_stat_statements with a 1.45 s mean (37 s max). The existing (org_id, project_id) index
-- returns the rows but PostgreSQL still sorts them by version DESC, created_at DESC inside each project (an
-- incremental sort). This index stores them already in that order, so the sort disappears.
-- Measured on a temp copy of the live table (14,393 BOQs, one project holding 14,284): 57.8 ms -> 19.7 ms (about 3x).
-- Partial (status != 'superseded') so superseded revisions, the bulk of a long-lived project, are not indexed twice.
CREATE INDEX IF NOT EXISTS idx_construction_boqs_latest
  ON compliance.construction_boqs (org_id, project_id, version DESC, created_at DESC)
  WHERE status <> 'superseded';
