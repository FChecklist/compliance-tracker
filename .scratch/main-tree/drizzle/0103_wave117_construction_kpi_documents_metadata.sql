-- Construction Intelligence, Wave 117 (2026-07-08): KPI module + Documents
-- metadata extension (Permits/Drawings/Site Photos). Third of 5 waves
-- building the PROJEXA construction modules inside VERIDIAN AI OS.

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.construction_kpi_period AS ENUM ('monthly', 'quarterly', 'milestone');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.construction_kpi_approval_status AS ENUM ('draft', 'submitted', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Additive column on existing table
-- ============================================================
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ============================================================
-- 3. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.construction_kpi_definitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text,
  metric_name text NOT NULL,
  target_value numeric,
  unit text,
  period compliance.construction_kpi_period NOT NULL DEFAULT 'monthly',
  owner_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_kpi_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kpi_definition_id text NOT NULL,
  period text NOT NULL,
  actual_value numeric NOT NULL,
  filled_by_id text NOT NULL,
  approval_status compliance.construction_kpi_approval_status NOT NULL DEFAULT 'draft',
  approved_by_id text,
  approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. Row Level Security
-- ============================================================
ALTER TABLE compliance.construction_kpi_definitions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_kpi_definitions FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_kpi_definitions ON compliance.construction_kpi_definitions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.construction_kpi_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_kpi_entries FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.construction_kpi_definitions d WHERE d.id = construction_kpi_entries.kpi_definition_id AND d.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_kpi_entries ON compliance.construction_kpi_entries FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
