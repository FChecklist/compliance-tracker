-- Priority 13 (Self-Serve Ad-Hoc BI / Chart-Builder, MVP scope). Confirmed
-- gap: the existing Reports & Analysis Engine (report_definitions, drizzle/
-- 0180-0183) is a curated, developer/AI-authored catalog; custom-report-
-- service.ts's savedReports (Wave 31) already lets a user build a live count-
-- only chart, but only over 5 whitelisted tables (GROUP_BY_FIELDS) with no
-- sum/avg aggregation. This migration adds custom_charts -- a thin,
-- org-scoped, per-user chart definition that reuses report-engine-
-- service.ts's own TABLE_REGISTRY (28+ tables) and AggregationConfig shape
-- verbatim (via its exported runAggregationFromConfig()) instead of adding a
-- second table whitelist or a second query engine. See custom-chart-
-- service.ts for validation/execution.

CREATE TABLE IF NOT EXISTS compliance.custom_charts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  chart_type text NOT NULL DEFAULT 'bar', -- 'bar' | 'line' | 'pie' | 'table'
  aggregation_config jsonb NOT NULL, -- report-engine-service.ts AggregationConfig shape
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.custom_charts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.custom_charts FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_custom_charts ON compliance.custom_charts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.custom_charts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.custom_charts TO service_role;

CREATE INDEX IF NOT EXISTS idx_custom_charts_org_id ON compliance.custom_charts(org_id);

INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('custom_charts', 'dashboard', 'name', NULL, NULL, 'org_id', 'created_by_id', NULL)
ON CONFLICT (source_table) DO NOTHING;

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.custom_charts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('custom_charts', 'Self-Serve Ad-Hoc BI / Chart Builder', 'custom_charts', 'reporting', 'TOOLS', false, 'Priority 13 MVP: lets a business user pick a TABLE_REGISTRY dataset + aggregation (count/sum/avg) + chart type (bar/line/pie/table) without a developer writing a new report_definitions row. Reuses report-engine-service.ts''s existing whitelist and aggregation executor -- no second query engine.')
ON CONFLICT (module_key) DO NOTHING;
