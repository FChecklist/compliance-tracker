-- "Need a Report / Need an Analysis" upload-to-AI flow (Owner request,
-- 2026-07-13). custom-report-service.ts's existing saved_reports table is
-- purpose-built for LIVE whitelisted grouped-count queries (sourceEntity +
-- groupByField, see that file's own header) -- there is no column anywhere
-- to hold a one-off, AI-proposed report built from something a user
-- uploaded (an image/Excel/Word file), which has arbitrary columns/rows,
-- not a groupValue/count pair. Rather than invent a second, parallel
-- "saved report" table/service (and a second render path in
-- CustomReportsSection.tsx), this adds one nullable jsonb column that only
-- ever gets populated for the new sourceEntity sentinel 'ai_generated' --
-- every pre-existing row/report keeps sourceEntity in
-- custom-report-service.ts's GROUP_BY_FIELDS whitelist and this column
-- stays null, completely unaffected.
--
-- ai_generated_data shape (AiGeneratedReportData, ai-report-builder-
-- service.ts): { title, summary, columns: string[], rows: Record<string,
-- string|number>[], chartType: 'table'|'bar'|'pie'|'line', chartRows:
-- {groupValue,count}[] }. chartRows exists so an ai_generated report can
-- still flow through the SAME ReportChart component CustomReportsSection.tsx
-- already renders bar/pie/line saved reports with (groupValue/count shape) --
-- no new charting path. columns/rows carry the full, possibly-multi-column
-- table for the table view, which ReportChart's existing two-column
-- name/value table branch can't represent.
--
-- source_file_name is provenance only (what the user uploaded) -- shown in
-- the UI so a redisplayed AI-generated report is traceable back to its
-- source, never used in any query.
--
-- NOT applied to the live database by this PR -- per this repo's
-- established convention (see drizzle/0176_audit_protocol_findings.sql and
-- every other migration this session), a separate audit step (Super Boss /
-- Claude Desktop) reviews and applies this via the Supabase MCP after
-- review, then merges.

ALTER TABLE compliance.saved_reports ADD COLUMN IF NOT EXISTS ai_generated_data jsonb;
ALTER TABLE compliance.saved_reports ADD COLUMN IF NOT EXISTS source_file_name text;

COMMENT ON COLUMN compliance.saved_reports.source_entity IS
  '''compliance_items'' | ''notices'' | ''risks'' | ''pms_issues'' | ''incidents'' | ''construction_boqs'' | ''construction_work_progress_entries'' | ''construction_attendance'' (live whitelisted query, see custom-report-service.ts GROUP_BY_FIELDS) | ''ai_generated'' (static AI-proposed report from an uploaded file, see ai_generated_data column -- never runs a live query)';
