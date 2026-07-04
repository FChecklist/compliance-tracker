-- Wave 49 (VERI ERP, part 2/4): Assets schema (categories, fixed asset
-- register, depreciation schedules, movements, disposals). Adapted from
-- frappe/erpnext's Asset doctype shape.

DO $$ BEGIN
  CREATE TYPE compliance.erp_asset_status AS ENUM ('draft', 'submitted', 'in_use', 'disposed', 'scrapped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.erp_depreciation_method AS ENUM ('straight_line', 'written_down_value');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_asset_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  category_name text NOT NULL,
  default_depreciation_method compliance.erp_depreciation_method NOT NULL DEFAULT 'straight_line',
  default_useful_life_months integer,
  asset_account_id text REFERENCES compliance.erp_accounts(id),
  depreciation_expense_account_id text REFERENCES compliance.erp_accounts(id),
  accumulated_depreciation_account_id text REFERENCES compliance.erp_accounts(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_fixed_assets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  asset_name text NOT NULL,
  asset_category_id text NOT NULL REFERENCES compliance.erp_asset_categories(id),
  department_id text REFERENCES compliance.departments(id),
  custodian_user_id text REFERENCES compliance.users(id),
  location text,
  purchase_date date NOT NULL,
  purchase_cost numeric NOT NULL,
  depreciation_method compliance.erp_depreciation_method NOT NULL DEFAULT 'straight_line',
  useful_life_months integer,
  salvage_value numeric NOT NULL DEFAULT 0,
  status compliance.erp_asset_status NOT NULL DEFAULT 'draft',
  current_value numeric,
  accumulated_depreciation numeric NOT NULL DEFAULT 0,
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_depreciation_schedules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  asset_id text NOT NULL REFERENCES compliance.erp_fixed_assets(id),
  schedule_date date NOT NULL,
  depreciation_amount numeric NOT NULL,
  accumulated_depreciation_after numeric NOT NULL,
  is_posted boolean NOT NULL DEFAULT false,
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id)
);

CREATE TABLE IF NOT EXISTS compliance.erp_asset_movements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  asset_id text NOT NULL REFERENCES compliance.erp_fixed_assets(id),
  movement_date date NOT NULL,
  from_location text,
  to_location text,
  from_custodian_id text REFERENCES compliance.users(id),
  to_custodian_id text REFERENCES compliance.users(id),
  purpose text,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_asset_disposals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  asset_id text NOT NULL REFERENCES compliance.erp_fixed_assets(id),
  disposal_date date NOT NULL,
  disposal_type text NOT NULL,
  sale_value numeric,
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_asset_categories', 'erp_fixed_assets', 'erp_depreciation_schedules',
    'erp_asset_movements', 'erp_asset_disposals'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_asset_categories FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_fixed_assets FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_depreciation_schedules FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_fixed_assets a WHERE a.id = erp_depreciation_schedules.asset_id AND a.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_asset_movements FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_fixed_assets a WHERE a.id = erp_asset_movements.asset_id AND a.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_asset_disposals FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_fixed_assets a WHERE a.id = erp_asset_disposals.asset_id AND a.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_asset_categories', 'erp_fixed_assets', 'erp_depreciation_schedules',
    'erp_asset_movements', 'erp_asset_disposals'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_asset_categories, compliance.erp_fixed_assets, compliance.erp_depreciation_schedules,
  compliance.erp_asset_movements, compliance.erp_asset_disposals
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_asset_categories, compliance.erp_fixed_assets, compliance.erp_depreciation_schedules,
  compliance.erp_asset_movements, compliance.erp_asset_disposals
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_asset_categories_org_id ON compliance.erp_asset_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_categories_asset_account_id ON compliance.erp_asset_categories(asset_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_categories_depreciation_expense_account_id ON compliance.erp_asset_categories(depreciation_expense_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_categories_accumulated_depreciation_account_id ON compliance.erp_asset_categories(accumulated_depreciation_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_fixed_assets_org_id ON compliance.erp_fixed_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_fixed_assets_asset_category_id ON compliance.erp_fixed_assets(asset_category_id);
CREATE INDEX IF NOT EXISTS idx_erp_fixed_assets_department_id ON compliance.erp_fixed_assets(department_id);
CREATE INDEX IF NOT EXISTS idx_erp_fixed_assets_custodian_user_id ON compliance.erp_fixed_assets(custodian_user_id);
CREATE INDEX IF NOT EXISTS idx_erp_fixed_assets_journal_entry_id ON compliance.erp_fixed_assets(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_depreciation_schedules_asset_id ON compliance.erp_depreciation_schedules(asset_id);
CREATE INDEX IF NOT EXISTS idx_erp_depreciation_schedules_journal_entry_id ON compliance.erp_depreciation_schedules(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_movements_asset_id ON compliance.erp_asset_movements(asset_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_movements_from_custodian_id ON compliance.erp_asset_movements(from_custodian_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_movements_to_custodian_id ON compliance.erp_asset_movements(to_custodian_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_movements_created_by_id ON compliance.erp_asset_movements(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_disposals_asset_id ON compliance.erp_asset_disposals(asset_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_disposals_journal_entry_id ON compliance.erp_asset_disposals(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_disposals_created_by_id ON compliance.erp_asset_disposals(created_by_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_assets', 'Fixed Assets', 'erp_fixed_assets', 'erp', 'Assets', false, 'Asset register, depreciation, movements, disposals')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_assets'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
