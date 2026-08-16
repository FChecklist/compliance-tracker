-- Wave 68 (TDS auto-computation, per ERPNext's Income Tax Slab + Tax
-- Withholding Category doctypes as reference -- read-only, GPL-3.0, no
-- code copied): payroll TDS via a real, admin-editable income-tax-slab
-- engine (old/new regime as two separate slab records, never hardcoded);
-- vendor-payment TDS via a Tax Withholding Category mechanism applied at
-- purchase-invoice-submit time.

CREATE TABLE IF NOT EXISTS compliance.erp_income_tax_slabs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  effective_from date NOT NULL,
  standard_deduction numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_income_tax_slab_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slab_id text NOT NULL REFERENCES compliance.erp_income_tax_slabs(id) ON DELETE CASCADE,
  from_amount numeric NOT NULL,
  to_amount numeric,
  percent_deduction numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS compliance.erp_employee_tax_exemptions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  employee_id text NOT NULL REFERENCES compliance.employee_profiles(id),
  financial_year text NOT NULL,
  category text NOT NULL,
  amount numeric NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_tax_withholding_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  category_name text NOT NULL,
  tax_deduction_basis text NOT NULL DEFAULT 'net_total',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_tax_withholding_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category_id text NOT NULL REFERENCES compliance.erp_tax_withholding_categories(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date,
  rate numeric NOT NULL,
  single_threshold numeric,
  cumulative_threshold numeric
);

ALTER TABLE compliance.employee_profiles ADD COLUMN IF NOT EXISTS income_tax_slab_id text REFERENCES compliance.erp_income_tax_slabs(id);
ALTER TABLE compliance.erp_suppliers ADD COLUMN IF NOT EXISTS tax_withholding_category_id text REFERENCES compliance.erp_tax_withholding_categories(id);
ALTER TABLE compliance.erp_purchase_invoices ADD COLUMN IF NOT EXISTS tds_amount numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_erp_income_tax_slabs_org_id ON compliance.erp_income_tax_slabs(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_income_tax_slab_rates_slab_id ON compliance.erp_income_tax_slab_rates(slab_id);
CREATE INDEX IF NOT EXISTS idx_erp_employee_tax_exemptions_org_id ON compliance.erp_employee_tax_exemptions(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_employee_tax_exemptions_employee_id ON compliance.erp_employee_tax_exemptions(employee_id);
CREATE INDEX IF NOT EXISTS idx_erp_tax_withholding_categories_org_id ON compliance.erp_tax_withholding_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_tax_withholding_rates_category_id ON compliance.erp_tax_withholding_rates(category_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_income_tax_slab_id ON compliance.employee_profiles(income_tax_slab_id);
CREATE INDEX IF NOT EXISTS idx_erp_suppliers_tax_withholding_category_id ON compliance.erp_suppliers(tax_withholding_category_id);

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_income_tax_slabs', 'erp_income_tax_slab_rates', 'erp_employee_tax_exemptions',
    'erp_tax_withholding_categories', 'erp_tax_withholding_rates'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_income_tax_slabs', 'erp_employee_tax_exemptions', 'erp_tax_withholding_categories'
  ])
  LOOP
    EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_income_tax_slab_rates FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_income_tax_slabs s WHERE s.id = erp_income_tax_slab_rates.slab_id AND s.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_tax_withholding_rates FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_tax_withholding_categories c WHERE c.id = erp_tax_withholding_rates.category_id AND c.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_income_tax_slabs', 'erp_income_tax_slab_rates', 'erp_employee_tax_exemptions',
    'erp_tax_withholding_categories', 'erp_tax_withholding_rates'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_income_tax_slabs, compliance.erp_income_tax_slab_rates, compliance.erp_employee_tax_exemptions,
  compliance.erp_tax_withholding_categories, compliance.erp_tax_withholding_rates
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_income_tax_slabs, compliance.erp_income_tax_slab_rates, compliance.erp_employee_tax_exemptions,
  compliance.erp_tax_withholding_categories, compliance.erp_tax_withholding_rates
  TO service_role;
