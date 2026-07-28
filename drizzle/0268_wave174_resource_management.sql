-- Construction Intelligence, Wave 174 (2026-07-28): Owner resource-management
-- spec items 7-10 -- Manpower cost reporting (reuses existing
-- construction_labour_roster/construction_attendance, no new tables),
-- Material catalog + inbound receiving, Budget per-scope-line-item markup
-- config, Schedule (Excel-imported baseline, reuses construction_activities/
-- construction_work_progress_entries for real progress -- no second
-- progress-tracking column here).

-- ============================================================
-- 1. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.construction_materials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  spec text NOT NULL,
  unit text NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  qty_on_hand numeric NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_material_inbound (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL,
  received_date date NOT NULL,
  quantity_received numeric NOT NULL,
  unit_cost numeric NOT NULL,
  total_cost numeric NOT NULL,
  vendor_name text,
  recorded_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_budget_line_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  boq_line_item_id text NOT NULL,
  markup_percent numeric,
  vendor_name text,
  vendor_amount numeric,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT construction_budget_line_items_boq_line_item_unique UNIQUE (boq_line_item_id)
);

CREATE TABLE IF NOT EXISTS compliance.construction_schedule_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  wbs_code text,
  task_name text NOT NULL,
  unit text,
  planned_quantity numeric,
  planned_start_date date,
  planned_end_date date,
  activity_id text,
  source_file_name text,
  imported_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Row Level Security
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'construction_materials', 'construction_material_inbound',
    'construction_budget_line_items', 'construction_schedule_items'
  ]
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
