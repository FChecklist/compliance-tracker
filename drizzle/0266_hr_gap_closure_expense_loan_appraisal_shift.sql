-- Phase 0 HR gap-closure (Owner directive
-- DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE, 2026-07-27).
-- 4 real, code-verified gaps closed here, additive only -- no existing
-- table altered except 2 nullable columns (hr_attendance_records.
-- shift_type_id, performance_reviews.weighted_score). See schema.ts's own
-- comments on each table below for the full rationale.

-- ============================================================
-- 1. Employee Expense Claims / Reimbursement
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.hr_expense_claim_status AS ENUM ('pending', 'approved', 'rejected', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.hr_expense_claims (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  company_id text,
  user_id text NOT NULL,
  category text NOT NULL,
  amount numeric NOT NULL,
  expense_date date NOT NULL,
  description text,
  receipt_url text,
  status compliance.hr_expense_claim_status NOT NULL DEFAULT 'pending',
  approver_id text,
  approved_at timestamp,
  rejection_reason text,
  payroll_run_id text REFERENCES compliance.erp_payroll_runs(id),
  reimbursed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Employee Loans / Salary Advances
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.hr_loan_type AS ENUM ('loan', 'advance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.hr_loan_status AS ENUM ('pending', 'approved', 'rejected', 'active', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.hr_loan_installment_status AS ENUM ('pending', 'deducted', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.hr_employee_loans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  employee_id text NOT NULL REFERENCES compliance.employee_profiles(id),
  loan_type compliance.hr_loan_type NOT NULL DEFAULT 'loan',
  principal_amount numeric NOT NULL,
  reason text,
  num_installments integer NOT NULL,
  installment_amount numeric,
  outstanding_balance numeric,
  status compliance.hr_loan_status NOT NULL DEFAULT 'pending',
  approver_id text,
  approved_at timestamp,
  rejection_reason text,
  disbursed_at timestamp,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.hr_loan_installments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  loan_id text NOT NULL REFERENCES compliance.hr_employee_loans(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  due_month integer NOT NULL,
  due_year integer NOT NULL,
  amount numeric NOT NULL,
  status compliance.hr_loan_installment_status NOT NULL DEFAULT 'pending',
  payroll_run_id text REFERENCES compliance.erp_payroll_runs(id),
  deducted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Shift Management / Roster
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.hr_shift_types (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.hr_shift_roster_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  user_id text NOT NULL,
  shift_type_id text NOT NULL REFERENCES compliance.hr_shift_types(id),
  start_date date NOT NULL,
  end_date date,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.hr_attendance_records ADD COLUMN IF NOT EXISTS shift_type_id text;

-- ============================================================
-- 4. Performance: KRA/Weighted Goals + Multi-Rater (360) Feedback
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.performance_goal_status AS ENUM ('pending', 'rated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.performance_rater_role AS ENUM ('peer', 'subordinate', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.performance_rater_status AS ENUM ('pending', 'submitted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.performance_reviews ADD COLUMN IF NOT EXISTS weighted_score numeric;

CREATE TABLE IF NOT EXISTS compliance.performance_review_goals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  review_id text NOT NULL REFERENCES compliance.performance_reviews(id) ON DELETE CASCADE,
  title text NOT NULL,
  weight_percent numeric NOT NULL,
  rating integer,
  comments text,
  status compliance.performance_goal_status NOT NULL DEFAULT 'pending',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.performance_review_raters (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  review_id text NOT NULL REFERENCES compliance.performance_reviews(id) ON DELETE CASCADE,
  rater_id text NOT NULL,
  rater_role compliance.performance_rater_role NOT NULL,
  rating integer,
  feedback text,
  status compliance.performance_rater_status NOT NULL DEFAULT 'pending',
  submitted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS (ARCH-03 org-scoped RLS+FORCE convention -- see drizzle/0050's own
-- header for the identical pattern this mirrors)
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'hr_expense_claims', 'hr_employee_loans', 'hr_loan_installments',
    'hr_shift_types', 'hr_shift_roster_assignments',
    'performance_review_goals', 'performance_review_raters'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE compliance.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.hr_expense_claims FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.hr_employee_loans FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.hr_loan_installments FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.hr_employee_loans l WHERE l.id = hr_loan_installments.loan_id AND l.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.hr_shift_types FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.hr_shift_roster_assignments FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.performance_review_goals FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.performance_review_raters FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'hr_expense_claims', 'hr_employee_loans', 'hr_loan_installments',
    'hr_shift_types', 'hr_shift_roster_assignments',
    'performance_review_goals', 'performance_review_raters'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.hr_expense_claims, compliance.hr_employee_loans, compliance.hr_loan_installments,
  compliance.hr_shift_types, compliance.hr_shift_roster_assignments,
  compliance.performance_review_goals, compliance.performance_review_raters
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.hr_expense_claims, compliance.hr_employee_loans, compliance.hr_loan_installments,
  compliance.hr_shift_types, compliance.hr_shift_roster_assignments,
  compliance.performance_review_goals, compliance.performance_review_raters
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_hr_expense_claims_org_id ON compliance.hr_expense_claims(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_expense_claims_user_id ON compliance.hr_expense_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_hr_expense_claims_status ON compliance.hr_expense_claims(status);
CREATE INDEX IF NOT EXISTS idx_hr_employee_loans_org_id ON compliance.hr_employee_loans(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_loans_employee_id ON compliance.hr_employee_loans(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_loans_status ON compliance.hr_employee_loans(status);
CREATE INDEX IF NOT EXISTS idx_hr_loan_installments_loan_id ON compliance.hr_loan_installments(loan_id);
CREATE INDEX IF NOT EXISTS idx_hr_loan_installments_due ON compliance.hr_loan_installments(due_year, due_month);
CREATE INDEX IF NOT EXISTS idx_hr_shift_types_org_id ON compliance.hr_shift_types(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_shift_roster_org_id ON compliance.hr_shift_roster_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_shift_roster_user_id ON compliance.hr_shift_roster_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_hr_shift_roster_dates ON compliance.hr_shift_roster_assignments(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_performance_review_goals_review_id ON compliance.performance_review_goals(review_id);
CREATE INDEX IF NOT EXISTS idx_performance_review_raters_review_id ON compliance.performance_review_raters(review_id);
