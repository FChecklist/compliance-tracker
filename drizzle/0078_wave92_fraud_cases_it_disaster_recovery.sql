-- Wave 92 (Comparison CSV 3 gap analysis: GRC012 "Fraud Management" +
-- GRC009 "Disaster Recovery"). Fraud case register -- zero fraud-detection/
-- case-tracking capability existed anywhere before this wave. IT Disaster
-- Recovery is deliberately distinct from Wave 89's bcm_plans: BCM models
-- generic business-process recovery narrative, whereas DR here is
-- IT-system-specific (RTO/RPO per system, backup verification, failover
-- test history).

CREATE TABLE IF NOT EXISTS compliance.fraud_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  case_number integer NOT NULL,
  title text NOT NULL,
  fraud_type text NOT NULL DEFAULT 'other',
  detection_source text NOT NULL DEFAULT 'other',
  description text,
  financial_exposure numeric,
  status text NOT NULL DEFAULT 'reported',
  reported_date date NOT NULL,
  investigator_id text,
  resolution_summary text,
  resolved_date date,
  linked_risk_id text,
  client_id text,
  recorded_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.it_dr_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  system_name text NOT NULL,
  system_description text,
  criticality_level text NOT NULL DEFAULT 'medium',
  rto_hours numeric NOT NULL,
  rpo_hours numeric NOT NULL,
  backup_frequency text NOT NULL DEFAULT 'daily',
  status text NOT NULL DEFAULT 'active',
  owner_id text,
  client_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.it_dr_backup_verifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dr_plan_id text NOT NULL REFERENCES compliance.it_dr_plans(id) ON DELETE CASCADE,
  verification_date date NOT NULL,
  status text NOT NULL DEFAULT 'success',
  notes text,
  verified_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.it_dr_failover_tests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dr_plan_id text NOT NULL REFERENCES compliance.it_dr_plans(id) ON DELETE CASCADE,
  test_date date NOT NULL,
  test_type text NOT NULL DEFAULT 'tabletop',
  outcome text NOT NULL DEFAULT 'passed',
  findings text,
  conducted_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fraud_cases_org_id ON compliance.fraud_cases(org_id);
CREATE INDEX IF NOT EXISTS idx_it_dr_plans_org_id ON compliance.it_dr_plans(org_id);
CREATE INDEX IF NOT EXISTS idx_it_dr_backup_verifications_plan_id ON compliance.it_dr_backup_verifications(dr_plan_id);
CREATE INDEX IF NOT EXISTS idx_it_dr_failover_tests_plan_id ON compliance.it_dr_failover_tests(dr_plan_id);

ALTER TABLE compliance.fraud_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.it_dr_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.it_dr_backup_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.it_dr_failover_tests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.fraud_cases FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.it_dr_plans FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.it_dr_backup_verifications FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.it_dr_plans p WHERE p.id = it_dr_backup_verifications.dr_plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.it_dr_failover_tests FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.it_dr_plans p WHERE p.id = it_dr_failover_tests.dr_plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['fraud_cases', 'it_dr_plans', 'it_dr_backup_verifications', 'it_dr_failover_tests'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.fraud_cases, compliance.it_dr_plans, compliance.it_dr_backup_verifications, compliance.it_dr_failover_tests
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.fraud_cases, compliance.it_dr_plans, compliance.it_dr_backup_verifications, compliance.it_dr_failover_tests
  TO service_role;
