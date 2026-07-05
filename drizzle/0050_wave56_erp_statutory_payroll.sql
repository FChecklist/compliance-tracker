-- Wave 56 (VERI ERP gap-fill, Tier 2 #5/#6): Indian Statutory Payroll.
-- Deliberately scoped narrower than the full ask: PF, ESI, and Professional
-- Tax are built as a real, configurable rule engine -- rates/ceilings/slabs
-- live in erp_statutory_rules as admin-editable master data, never
-- hardcoded in code, since these change via periodic government
-- notification. TDS (income tax) is NOT auto-computed -- correct TDS
-- depends on regime choice, exemptions, and annual slab projection, none
-- of which can be safely approximated without real risk of an incorrect
-- statutory deduction. Every payslip carries a manually-entered TDS line.

DO $$ BEGIN
  CREATE TYPE compliance.erp_salary_component_type AS ENUM ('earning', 'deduction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_component_calc_type AS ENUM ('flat', 'percentage_of_basic', 'percentage_of_gross');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_statutory_rule_type AS ENUM ('pf', 'esi', 'professional_tax');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_payroll_run_status AS ENUM ('draft', 'processed', 'paid', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_payslip_line_type AS ENUM ('earning', 'deduction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_salary_components (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  component_type compliance.erp_salary_component_type NOT NULL,
  calculation_type compliance.erp_component_calc_type NOT NULL DEFAULT 'flat',
  default_percentage numeric,
  default_amount numeric,
  is_statutory boolean NOT NULL DEFAULT false,
  include_in_pf_wage boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_salary_structures (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  employee_id text NOT NULL REFERENCES compliance.employee_profiles(id),
  effective_from date NOT NULL,
  ctc_annual numeric NOT NULL,
  state text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_salary_structure_components (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  structure_id text NOT NULL REFERENCES compliance.erp_salary_structures(id) ON DELETE CASCADE,
  component_id text NOT NULL REFERENCES compliance.erp_salary_components(id),
  amount numeric,
  percentage numeric
);

CREATE TABLE IF NOT EXISTS compliance.erp_statutory_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  rule_type compliance.erp_statutory_rule_type NOT NULL,
  state text,
  effective_from date NOT NULL,
  effective_to date,
  employee_rate numeric,
  employer_rate numeric,
  wage_ceiling numeric,
  slabs jsonb,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_payroll_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  month integer NOT NULL,
  year integer NOT NULL,
  status compliance.erp_payroll_run_status NOT NULL DEFAULT 'draft',
  processed_at timestamp,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (org_id, month, year)
);

CREATE TABLE IF NOT EXISTS compliance.erp_payslips (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  payroll_run_id text NOT NULL REFERENCES compliance.erp_payroll_runs(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES compliance.employee_profiles(id),
  gross_earnings numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_payslip_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  payslip_id text NOT NULL REFERENCES compliance.erp_payslips(id) ON DELETE CASCADE,
  component_id text REFERENCES compliance.erp_salary_components(id),
  label text NOT NULL,
  line_type compliance.erp_payslip_line_type NOT NULL,
  amount numeric NOT NULL DEFAULT 0
);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_salary_components', 'erp_salary_structures', 'erp_salary_structure_components',
    'erp_statutory_rules', 'erp_payroll_runs', 'erp_payslips', 'erp_payslip_lines'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_salary_components FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_salary_structures FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_salary_structure_components FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_salary_structures s WHERE s.id = erp_salary_structure_components.structure_id AND s.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_statutory_rules FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_payroll_runs FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_payslips FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_payslip_lines FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_payslips p WHERE p.id = erp_payslip_lines.payslip_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_salary_components', 'erp_salary_structures', 'erp_salary_structure_components',
    'erp_statutory_rules', 'erp_payroll_runs', 'erp_payslips', 'erp_payslip_lines'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_salary_components, compliance.erp_salary_structures, compliance.erp_salary_structure_components,
  compliance.erp_statutory_rules, compliance.erp_payroll_runs, compliance.erp_payslips, compliance.erp_payslip_lines
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_salary_components, compliance.erp_salary_structures, compliance.erp_salary_structure_components,
  compliance.erp_statutory_rules, compliance.erp_payroll_runs, compliance.erp_payslips, compliance.erp_payslip_lines
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_salary_components_org_id ON compliance.erp_salary_components(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_salary_structures_org_id ON compliance.erp_salary_structures(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_salary_structures_employee_id ON compliance.erp_salary_structures(employee_id);
CREATE INDEX IF NOT EXISTS idx_erp_ssc_structure_id ON compliance.erp_salary_structure_components(structure_id);
CREATE INDEX IF NOT EXISTS idx_erp_ssc_component_id ON compliance.erp_salary_structure_components(component_id);
CREATE INDEX IF NOT EXISTS idx_erp_statutory_rules_org_id ON compliance.erp_statutory_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_payroll_runs_org_id ON compliance.erp_payroll_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_payslips_org_id ON compliance.erp_payslips(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_payslips_payroll_run_id ON compliance.erp_payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_erp_payslips_employee_id ON compliance.erp_payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_erp_payslip_lines_payslip_id ON compliance.erp_payslip_lines(payslip_id);
CREATE INDEX IF NOT EXISTS idx_erp_payslip_lines_component_id ON compliance.erp_payslip_lines(component_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_payroll', 'Statutory Payroll (PF/ESI/PT)', 'erp_payroll_runs', 'erp', 'HR', false, 'Salary structures, configurable PF/ESI/Professional Tax rule engine, payroll runs and payslips. TDS is manually entered, not auto-computed.')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_payroll'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
