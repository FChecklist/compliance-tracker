-- AUDIT-100 B15/B31/B58 (2026-10-05): two missing indexes behind the slow construction queries that overloaded the shared database.
-- Additive and idempotent (CREATE INDEX IF NOT EXISTS); no data is changed. Applied live through the Supabase MCP, then committed here.
--
-- compliance.construction_work_progress_entries had only its primary key and a boq_line_item_id index. "The latest progress of each
-- activity" (SELECT ... FROM construction_activities a LEFT JOIN LATERAL (SELECT percent_complete, entry_date FROM
-- construction_work_progress_entries e WHERE e.activity_id = a.id ORDER BY e.entry_date DESC LIMIT 1) ...) therefore scanned the whole
-- table once per activity: ~2,600 activities x 3,300 rows per call, mean 1.6 s and up to 10.5 s over 1,672 calls in pg_stat_statements,
-- which starved the AI work-link call log (503 after its 4 s time-box) while those queries ran.
-- compliance.construction_activities had only its primary key; the same query filters it by (org_id, project_id).
CREATE INDEX IF NOT EXISTS idx_construction_wpe_activity_entry_date
  ON compliance.construction_work_progress_entries (activity_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_construction_activities_org_project
  ON compliance.construction_activities (org_id, project_id);

-- The progress-entries list ("... WHERE org_id = $1 AND project_id = $2 ORDER BY entry_date DESC", mean 5.8 s, max 51.8 s over 289 calls)
-- also had no index for its filter.
CREATE INDEX IF NOT EXISTS idx_construction_wpe_org_project_entry_date
  ON compliance.construction_work_progress_entries (org_id, project_id, entry_date DESC);
