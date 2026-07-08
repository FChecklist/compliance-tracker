-- Construction Intelligence, Wave 120 (2026-07-08): enhance existing shared
-- modules for construction fit -- Vendor Master (trade/projectId on
-- erp_suppliers), project-linkage for Material Consumption & Revenue
-- reports (erp_stock_ledger_entries.project_id, erp_sales_invoices.
-- project_id), and a new expense-head classification layer. Fifth wave
-- building PROJEXA modules inside VERIDIAN AI OS. All additive.

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.construction_expense_head AS ENUM ('material', 'labour', 'transport', 'subcontractor', 'equipment', 'misc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Additive columns on existing tables
-- ============================================================
ALTER TABLE compliance.erp_suppliers ADD COLUMN IF NOT EXISTS trade text;
ALTER TABLE compliance.erp_suppliers ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE compliance.erp_sales_invoices ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE compliance.erp_stock_ledger_entries ADD COLUMN IF NOT EXISTS project_id text;

-- ============================================================
-- 3. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.construction_expense_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  expense_head compliance.construction_expense_head NOT NULL,
  description text,
  amount numeric NOT NULL,
  expense_date date NOT NULL,
  linked_entity_type text,
  linked_entity_id text,
  recorded_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. Row Level Security (new table only -- the 4 additive columns above
-- live on tables that already have RLS enabled from prior waves)
-- ============================================================
ALTER TABLE compliance.construction_expense_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_expense_entries FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_expense_entries ON compliance.construction_expense_entries FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
