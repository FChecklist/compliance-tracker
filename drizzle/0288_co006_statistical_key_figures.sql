-- CO-006 (sap_mapping.sqlite gap analysis, "Statistical Key Figure Report",
-- module CO, BUILD_NEW/LOW, veridian_existing_equivalent=None). Confirmed
-- via a fresh grep of src/lib/db/schema.ts and src/lib/services/ that zero
-- statistical-key-figure concept (non-financial per-cost-center allocation-
-- basis metric, e.g. headcount/square-meters/machine-hours) existed
-- anywhere in this codebase before this migration.
--
-- Two new tables, reusing existing dimensions rather than inventing
-- parallel ones (same precedent erp_budgets/0.. established for cost
-- center + fiscal year reuse):
--   erp_statistical_key_figure_types -- master data: name + unit of measure
--   erp_statistical_key_figure_postings -- one row per posting, scoped to
--     an existing erp_cost_centers row + erp_accounting_periods row,
--     carrying a plan/actual version tag. Actual/plan values for a given
--     type/cost-center/period are the SUM of all postings (matches SAP's
--     own KB21N additive-posting behaviour), not a single upserted value.
--
-- Deliberately lighter-weight than SAP's own two-transaction (KB21N
-- actual-posting / KP46 plan-entry) master-data-heavy model -- see this
-- PR's own description for the sap_mapping.sqlite implementation_notes
-- caveat this simplification responds to (that field argues against
-- building a *mandatory* SKF system at all; this stays an optional,
-- standalone verification report, not a dependency of any future overhead-
-- allocation engine).
--
-- Hand-written, NOT drizzle-kit's raw `generate` output -- same reason as
-- 0268_pms_time_entry_approval_flow.sql's own header (drizzle/meta/ is
-- missing per-migration snapshots between 0001 and 0264).

DO $$ BEGIN
  CREATE TYPE compliance.erp_statistical_key_figure_version AS ENUM ('plan', 'actual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_statistical_key_figure_types (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  name text NOT NULL,
  unit_of_measure text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erp_statistical_key_figure_types_org_id_idx ON compliance.erp_statistical_key_figure_types (org_id);

CREATE TABLE IF NOT EXISTS compliance.erp_statistical_key_figure_postings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  stat_key_figure_type_id text NOT NULL,
  cost_center_id text NOT NULL,
  accounting_period_id text NOT NULL,
  version compliance.erp_statistical_key_figure_version NOT NULL,
  value numeric NOT NULL,
  posted_by_id text,
  remark text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Drives the CO-006 report's own aggregation: sum postings grouped by
-- (type, cost center, period, version) for a given org.
CREATE INDEX IF NOT EXISTS erp_skf_postings_org_type_cc_period_idx ON compliance.erp_statistical_key_figure_postings (org_id, stat_key_figure_type_id, cost_center_id, accounting_period_id);
CREATE INDEX IF NOT EXISTS erp_skf_postings_period_idx ON compliance.erp_statistical_key_figure_postings (accounting_period_id);

-- Row Level Security -- matching 0269_construction_progress_claims_workflow.sql's
-- established app_runtime_tenant_isolation + service_role_bypass pattern.
ALTER TABLE compliance.erp_statistical_key_figure_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.erp_statistical_key_figure_types FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_skf_types ON compliance.erp_statistical_key_figure_types FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.erp_statistical_key_figure_postings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.erp_statistical_key_figure_postings FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_skf_postings ON compliance.erp_statistical_key_figure_postings FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
