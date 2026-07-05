-- Wave 70 (Budgeting, per COMPARISON_CSV_GAP_ANALYSIS.md -- Finance>Budgeting
-- was a complete gap with zero prior schema; independently designed,
-- reusing existing erp_cost_centers/erp_accounts/erp_fiscal_years
-- dimensions rather than inventing new ones. No third-party code copied.

CREATE TYPE compliance.erp_budget_action AS ENUM ('ignore', 'warn', 'stop');
CREATE TYPE compliance.erp_budget_status AS ENUM ('draft', 'submitted', 'cancelled');

CREATE TABLE IF NOT EXISTS compliance.erp_budgets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  fiscal_year_id text NOT NULL REFERENCES compliance.erp_fiscal_years(id),
  company_id text REFERENCES compliance.erp_companies(id),
  cost_center_id text REFERENCES compliance.erp_cost_centers(id),
  name text NOT NULL,
  action_if_exceeded compliance.erp_budget_action NOT NULL DEFAULT 'warn',
  status compliance.erp_budget_status NOT NULL DEFAULT 'draft',
  created_by_id text,
  submitted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_budget_line_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  budget_id text NOT NULL REFERENCES compliance.erp_budgets(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES compliance.erp_accounts(id),
  annual_amount numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_erp_budgets_org_id ON compliance.erp_budgets(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_budgets_fiscal_year_id ON compliance.erp_budgets(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_erp_budgets_cost_center_id ON compliance.erp_budgets(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_erp_budget_line_items_budget_id ON compliance.erp_budget_line_items(budget_id);
CREATE INDEX IF NOT EXISTS idx_erp_budget_line_items_account_id ON compliance.erp_budget_line_items(account_id);

ALTER TABLE compliance.erp_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_budget_line_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_budgets FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_budget_line_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_budgets b WHERE b.id = erp_budget_line_items.budget_id AND b.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_budgets ON compliance.erp_budgets FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_budget_line_items ON compliance.erp_budget_line_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_budgets, compliance.erp_budget_line_items TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_budgets, compliance.erp_budget_line_items TO service_role;
