-- R65 gap-closure: interior design sales packages (closes 8 report_definitions
-- data_gap rows: 3D Design Approval Report, Design Consultation Report,
-- Design Revision Report, Furniture Package Report, Interior Package
-- Comparison Report, Modular Kitchen Sales Report, Room-wise Estimate
-- Report, Wardrobe Sales Report). Genuinely distinct from Wave 142/143's
-- interior_mood_boards/interior_ffe_items/interior_floor_plans/
-- interior_materials (DESIGN/EXECUTION-side infrastructure) and from
-- erp_quotation_items/erp_sales_order_items (generic description/quantity/
-- rate/amount lines with no interior-design package-tier or design-asset
-- concept). See schema.ts's own header comment above interiorSalesPackages
-- for the full rationale.

CREATE TYPE compliance.interior_sales_package_type AS ENUM ('furniture', 'modular_kitchen', 'wardrobe', 'room_wise_estimate', 'other');
CREATE TYPE compliance.interior_design_approval_status AS ENUM ('not_started', 'in_progress', 'shared_for_approval', 'approved', 'revision_requested');

CREATE TABLE IF NOT EXISTS compliance.interior_sales_packages (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text,
  opportunity_id text,
  quotation_id text,
  sales_order_id text,
  package_type compliance.interior_sales_package_type NOT NULL DEFAULT 'other',
  package_tier text,
  room_or_area text,
  title text NOT NULL,
  total_value numeric NOT NULL DEFAULT 0,
  design_approval_status compliance.interior_design_approval_status NOT NULL DEFAULT 'not_started',
  consultation_booked_at timestamp,
  consultation_held_at timestamp,
  revision_number integer NOT NULL DEFAULT 1,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.interior_sales_package_items (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  package_id text NOT NULL REFERENCES compliance.interior_sales_packages(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_interior_sales_packages_org_id ON compliance.interior_sales_packages(org_id);
CREATE INDEX IF NOT EXISTS idx_interior_sales_packages_package_type ON compliance.interior_sales_packages(package_type);
CREATE INDEX IF NOT EXISTS idx_interior_sales_package_items_package_id ON compliance.interior_sales_package_items(package_id);

-- Tenant isolation is enforced at the application layer (org_id filtered in
-- every query, matching this codebase's real, existing convention) -- RLS
-- here just needs to not block app_runtime's own real access, same pattern
-- as drizzle/0336_construction_tenders.sql / 0333_r63_enable_rls_platform_tables.sql
-- (the real, current convention -- NOT the older session-variable
-- compliance.current_org_id() policy style used by 0125_wave142, which was
-- tried and corrected earlier in R63).
ALTER TABLE compliance.interior_sales_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_sales_package_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_runtime_full_access" ON compliance.interior_sales_packages
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY "app_runtime_full_access" ON compliance.interior_sales_package_items
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
