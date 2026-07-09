-- Wave 143: Visual design authoring -- 2D floor plan editor + 3D
-- walkthrough. Rooms are closed polygons (jsonb points, cm), walls are
-- derived from polygon edges at render time (no separate wall entity/
-- connectivity graph). Furniture placement reuses Wave 142's
-- interior_ffe_items rather than duplicating item data.

ALTER TABLE compliance.interior_ffe_items ADD COLUMN IF NOT EXISTS width_cm numeric;
ALTER TABLE compliance.interior_ffe_items ADD COLUMN IF NOT EXISTS depth_cm numeric;
ALTER TABLE compliance.interior_ffe_items ADD COLUMN IF NOT EXISTS height_cm numeric;

CREATE TABLE IF NOT EXISTS compliance.interior_floor_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  floor_level text,
  status text NOT NULL DEFAULT 'draft',
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TYPE compliance.interior_material_category AS ENUM ('flooring', 'wall', 'ceiling');

CREATE TABLE IF NOT EXISTS compliance.interior_materials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  name text NOT NULL,
  category compliance.interior_material_category NOT NULL,
  color_hex text NOT NULL DEFAULT '#cccccc',
  texture_document_id text,
  roughness numeric NOT NULL DEFAULT 0.8,
  metalness numeric NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.interior_floor_plan_rooms (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  floor_plan_id text NOT NULL REFERENCES compliance.interior_floor_plans(id) ON DELETE CASCADE,
  name text NOT NULL,
  polygon jsonb NOT NULL,
  ceiling_height_cm numeric NOT NULL DEFAULT 270,
  floor_material_id text,
  wall_material_id text,
  ceiling_material_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.interior_furniture_placements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  floor_plan_id text NOT NULL REFERENCES compliance.interior_floor_plans(id) ON DELETE CASCADE,
  room_id text,
  ffe_item_id text NOT NULL REFERENCES compliance.interior_ffe_items(id) ON DELETE CASCADE,
  x numeric NOT NULL DEFAULT 0,
  y numeric NOT NULL DEFAULT 0,
  rotation_deg numeric NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interior_floor_plans_org_project ON compliance.interior_floor_plans(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_interior_materials_org ON compliance.interior_materials(org_id);
CREATE INDEX IF NOT EXISTS idx_interior_floor_plan_rooms_plan ON compliance.interior_floor_plan_rooms(floor_plan_id);
CREATE INDEX IF NOT EXISTS idx_interior_furniture_placements_plan ON compliance.interior_furniture_placements(floor_plan_id);
CREATE INDEX IF NOT EXISTS idx_interior_furniture_placements_item ON compliance.interior_furniture_placements(ffe_item_id);

ALTER TABLE compliance.interior_floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_floor_plan_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_furniture_placements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_floor_plans FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interior_floor_plans ON compliance.interior_floor_plans FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_materials FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interior_materials ON compliance.interior_materials FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_floor_plan_rooms FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.interior_floor_plans p WHERE p.id = interior_floor_plan_rooms.floor_plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interior_floor_plan_rooms ON compliance.interior_floor_plan_rooms FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_furniture_placements FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.interior_floor_plans p WHERE p.id = interior_furniture_placements.floor_plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interior_furniture_placements ON compliance.interior_furniture_placements FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
