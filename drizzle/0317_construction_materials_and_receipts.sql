-- TWO NEW TABLES. Copy the constructionLabourRoster posture exactly (schema.ts line ~10211).
CREATE TABLE IF NOT EXISTS compliance.construction_materials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  spec text,
  unit text NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS compliance.construction_material_receipts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL REFERENCES compliance.construction_materials(id) ON DELETE RESTRICT,
  received_date date NOT NULL,
  quantity numeric NOT NULL,
  unit_cost numeric,
  vendor_id text,
  notes text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS construction_materials_project_idx ON compliance.construction_materials (project_id);
CREATE INDEX IF NOT EXISTS construction_material_receipts_material_idx ON compliance.construction_material_receipts (material_id);
CREATE INDEX IF NOT EXISTS construction_material_receipts_project_date_idx ON compliance.construction_material_receipts (org_id, project_id, received_date);
-- RLS, copying construction_progress_claims (drizzle/0269) VERBATIM in shape:
ALTER TABLE compliance.construction_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_material_receipts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_materials FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_construction_materials ON compliance.construction_materials FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_material_receipts FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_construction_material_receipts ON compliance.construction_material_receipts FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
