-- Construction Intelligence, Wave 115 (2026-07-08): Scope of Work/BOQ,
-- Work Progress hierarchy, Daily Site Diary. First of 5 waves building the
-- PROJEXA construction modules inside VERIDIAN AI OS -- PROJEXA (a separate
-- product) is a thin client that will consume these via /api/v1 (Wave 119),
-- not a duplicate implementation. No GPL/AGPL code copied (OpenConstructionERP
-- is AGPL-3.0) -- only domain concepts studied, matching this repo's existing
-- GST-engine precedent (0100_gst_reconciliation_engine.sql).

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.construction_boq_status AS ENUM ('draft', 'submitted', 'approved', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.construction_boqs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  parent_boq_id text,
  title text NOT NULL,
  status compliance.construction_boq_status NOT NULL DEFAULT 'draft',
  created_by_id text NOT NULL,
  approved_by_id text,
  approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_boq_line_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  boq_id text NOT NULL,
  activity_id text,
  item_code text,
  description text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  parent_category_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_activities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  category_id text NOT NULL,
  name text NOT NULL,
  unit text,
  planned_quantity numeric,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_work_progress_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  activity_id text NOT NULL,
  entry_date date NOT NULL,
  quantity_done numeric NOT NULL DEFAULT 0,
  percent_complete integer NOT NULL DEFAULT 0,
  remarks text,
  recorded_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_site_diaries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  diary_date date NOT NULL,
  weather text,
  work_done text,
  visitors text,
  issues text,
  instructions text,
  material_received text,
  labour_count integer,
  remarks text,
  recorded_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT construction_site_diaries_project_date_unique UNIQUE (project_id, diary_date)
);

-- ============================================================
-- 3. Row Level Security (app_runtime_tenant_isolation + service_role_bypass,
-- matching the standard pattern established in 0100_gst_reconciliation_engine.sql)
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['construction_boqs', 'construction_categories', 'construction_activities', 'construction_work_progress_entries', 'construction_site_diaries']
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_tenant_isolation ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

ALTER TABLE compliance.construction_boq_line_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_boq_line_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.construction_boqs b WHERE b.id = construction_boq_line_items.boq_id AND b.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_boq_line_items ON compliance.construction_boq_line_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
