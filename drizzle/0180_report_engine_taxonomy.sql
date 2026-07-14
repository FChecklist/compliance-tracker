-- Reports & Analysis Engine, Priority 11 (Owner directive 2026-07-13).
-- Two additive changes:
--
-- 1. compliance.report_definitions -- the declarative substrate the new
--    "engine" is built on. A definition is data (category/classifications/
--    periodicity/execution_type/execution_config), not a bespoke function --
--    new reports get ADDED as rows here, not as new hand-written TypeScript
--    per report, which is the actual "without reworking and without
--    duplicacy" requirement. org_id is nullable, same convention as
--    platform_assets/task_capabilities (0150/0156): null = a platform-wide
--    definition available to every org (the equivalent of report-catalog-
--    service.ts's existing static REPORT_CATALOG entries, just DB-backed so
--    new ones don't need a code deploy); a real org_id = an org-specific
--    definition (e.g. one an org's own AI report-builder promoted, or a
--    custom variant of a platform definition).
--
-- 2. compliance.report_schedules gains 3 nullable columns
--    (times_of_day/start_date/end_date) so the existing 3-cadence
--    (daily/weekly/monthly) scheduler can express the full periodicity
--    vocabulary in report-taxonomy.ts (hourly through custom-range) without
--    a breaking change -- every existing row's new columns default to
--    null/empty and behaves exactly as before.

CREATE TABLE IF NOT EXISTS compliance.report_definitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text REFERENCES compliance.organisations(id), -- nullable = platform-wide
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  classifications jsonb NOT NULL DEFAULT '[]', -- string[], see report-taxonomy.ts KNOWN_CLASSIFICATIONS (open list, not enum-enforced)
  periodicity text, -- null = on_demand/ad-hoc; see report-taxonomy.ts PERIODICITY_BASE_VALUES
  periodicity_config jsonb, -- PeriodicityConfig shape (timesOfDay/dayOfWeek/dayOfMonth/startDate/endDate)
  execution_type text NOT NULL, -- 'deterministic_aggregation' | 'deterministic_formula' | 'ai_recipe' | 'external_service'
  execution_config jsonb NOT NULL, -- shape depends on execution_type, see report-engine-service.ts
  output_formats jsonb NOT NULL DEFAULT '["table"]',
  status text NOT NULL DEFAULT 'built', -- 'built' | 'data_gap' | 'planned'
  data_gap_note text, -- required explanation when status != 'built' -- never silently claim built
  created_by text NOT NULL DEFAULT 'system', -- 'system' | 'ai' | a real users.id
  promoted_from_context text, -- when created_by='ai', a free-text pointer back to the ad-hoc request/upload this was promoted from (traceability, not a FK -- the source may be an ephemeral upload, not a persisted row)
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.report_definitions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped_or_platform_default ON compliance.report_definitions FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id() OR org_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_report_definitions ON compliance.report_definitions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_definitions TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_definitions TO service_role;

-- Universal Metadata Registry (UMR, Priority 4/0152) registration -- each
-- row is a genuinely named, purpose-bearing platform asset (a report or
-- analysis definition), the exact shape the UMR exists to index.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('report_definitions', 'report', 'name', 'description', NULL, 'org_id', NULL, 'is_active')
ON CONFLICT (source_table) DO NOTHING;

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.report_definitions
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE INDEX IF NOT EXISTS idx_report_definitions_org_id ON compliance.report_definitions(org_id);
CREATE INDEX IF NOT EXISTS idx_report_definitions_category ON compliance.report_definitions(category);
CREATE INDEX IF NOT EXISTS idx_report_definitions_status ON compliance.report_definitions(status);

ALTER TABLE compliance.report_schedules ADD COLUMN IF NOT EXISTS times_of_day jsonb;
ALTER TABLE compliance.report_schedules ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE compliance.report_schedules ADD COLUMN IF NOT EXISTS end_date date;

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('report_definitions', 'Report & Analysis Engine Definitions', 'report_definitions', 'reporting', 'TOOLS', false, 'Declarative substrate for the Reports & Analysis Engine (Priority 11) -- each row is one report/analysis definition (category/classification/periodicity/execution config), platform-wide (org_id null) or org-specific, executed generically by report-engine-service.ts rather than bespoke per-report code')
ON CONFLICT (module_key) DO NOTHING;
