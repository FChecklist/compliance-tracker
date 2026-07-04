-- Wave 40: VERIDIAN HR (PLATFORM_STRATEGY.md §19). minthcm/erpnext(hrms)/
-- orangehrm evaluated and rejected as software (PHP/Frappe monoliths, none
-- Vercel-serverless-deployable). Closes a real, confirmed gap: `users` has
-- auth fields plus department_id/reporting_to_id but zero employee master
-- data, and leave_policy_entries is policy text, not a request/balance
-- ledger. Payroll processing is deliberately out of scope. Org chart needs
-- no schema at all -- a read-only tree over the existing reporting_to_id.

CREATE TABLE IF NOT EXISTS compliance.employee_profiles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL UNIQUE REFERENCES compliance.users(id),
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  employee_code text,
  job_title text,
  employment_type text NOT NULL DEFAULT 'full_time',
  date_of_joining date,
  date_of_birth date,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.leave_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  leave_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  num_days numeric NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  approver_id text REFERENCES compliance.users(id),
  approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.leave_balances (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  leave_type text NOT NULL,
  year integer NOT NULL,
  total_days numeric NOT NULL DEFAULT 0,
  used_days numeric NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id, leave_type, year)
);

ALTER TABLE compliance.employee_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.employee_profiles FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_employee_profiles ON compliance.employee_profiles FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.employee_profiles TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.employee_profiles TO service_role;

ALTER TABLE compliance.leave_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.leave_requests FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_leave_requests ON compliance.leave_requests FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.leave_requests TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.leave_requests TO service_role;

ALTER TABLE compliance.leave_balances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.leave_balances FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_leave_balances ON compliance.leave_balances FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.leave_balances TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.leave_balances TO service_role;

CREATE INDEX IF NOT EXISTS idx_employee_profiles_org_id ON compliance.employee_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_org_id ON compliance.leave_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id ON compliance.leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_org_id ON compliance.leave_balances(org_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_user_id ON compliance.leave_balances(user_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('employee_profiles', 'Employee Directory', 'employee_profiles', 'hr', 'TOOLS', true, 'Employee master data (job title, employment type, joining date) extending users'),
  ('leave_requests', 'Leave Requests', 'leave_requests', 'hr', 'TOOLS', true, 'Employee-submitted, manager-approved leave requests'),
  ('leave_balances', 'Leave Balances', 'leave_balances', 'hr', 'TOOLS', true, 'Per-employee per-leave-type per-year balance ledger')
ON CONFLICT (module_key) DO NOTHING;
