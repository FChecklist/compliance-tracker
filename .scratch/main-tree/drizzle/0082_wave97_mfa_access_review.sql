-- Wave 97 (Comparison CSV 3 gap analysis: IAM003 "MFA Enrollment" + IAM010
-- "Access Review"). MFA itself needs no new schema -- it's Supabase Auth's
-- own native auth.mfa_factors/auth.mfa_challenges tables, driven entirely
-- via supabase-js's mfa.enroll/challenge/verify/unenroll. This migration is
-- the Access Review half only: a real periodic certification cycle over
-- existing RBAC assignments (users.role).

CREATE TABLE IF NOT EXISTS compliance.access_review_cycles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open',
  created_by_id text NOT NULL,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.access_review_certifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cycle_id text NOT NULL REFERENCES compliance.access_review_cycles(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  reviewed_role text NOT NULL,
  decision text NOT NULL DEFAULT 'pending',
  reviewed_by_id text,
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_review_cycles_org_id ON compliance.access_review_cycles(org_id);
CREATE INDEX IF NOT EXISTS idx_access_review_certifications_cycle_id ON compliance.access_review_certifications(cycle_id);
CREATE INDEX IF NOT EXISTS idx_access_review_certifications_org_id ON compliance.access_review_certifications(org_id);

ALTER TABLE compliance.access_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.access_review_certifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.access_review_cycles FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_access_review_cycles ON compliance.access_review_cycles FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.access_review_certifications FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_access_review_certifications ON compliance.access_review_certifications FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.access_review_cycles, compliance.access_review_certifications TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.access_review_cycles, compliance.access_review_certifications TO service_role;
