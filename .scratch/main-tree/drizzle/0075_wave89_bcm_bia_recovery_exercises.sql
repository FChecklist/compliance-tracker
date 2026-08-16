-- Wave 89 (Comparison CSV 2 gap analysis: BCM Business Impact Analysis +
-- Recovery Plan detail + Exercise log). bcm_plans was a bare name/last-
-- tested-date/status flag; this wave adds real BIA (impact/RTO/RPO per
-- business process), a recovery-procedure step list, and an exercise/drill
-- history log. None of the three child tables carry their own org_id --
-- RLS scopes via their parent plan (Wave 87/88 convention).

CREATE TABLE IF NOT EXISTS compliance.bcm_business_impact_analyses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id text NOT NULL REFERENCES compliance.bcm_plans(id) ON DELETE CASCADE,
  business_process_name text NOT NULL,
  impact_description text,
  rto_hours numeric,
  rpo_hours numeric,
  criticality_level text NOT NULL DEFAULT 'medium',
  dependencies text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.bcm_recovery_procedures (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id text NOT NULL REFERENCES compliance.bcm_plans(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  description text NOT NULL,
  responsible_user_id text,
  estimated_duration_minutes numeric,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.bcm_exercises (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id text NOT NULL REFERENCES compliance.bcm_plans(id) ON DELETE CASCADE,
  exercise_date date NOT NULL,
  exercise_type text NOT NULL,
  outcome text NOT NULL,
  findings text,
  conducted_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcm_bia_plan_id ON compliance.bcm_business_impact_analyses(plan_id);
CREATE INDEX IF NOT EXISTS idx_bcm_recovery_procedures_plan_id ON compliance.bcm_recovery_procedures(plan_id);
CREATE INDEX IF NOT EXISTS idx_bcm_exercises_plan_id ON compliance.bcm_exercises(plan_id);

ALTER TABLE compliance.bcm_business_impact_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.bcm_recovery_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.bcm_exercises ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.bcm_business_impact_analyses FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.bcm_plans p WHERE p.id = bcm_business_impact_analyses.plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.bcm_recovery_procedures FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.bcm_plans p WHERE p.id = bcm_recovery_procedures.plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.bcm_exercises FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.bcm_plans p WHERE p.id = bcm_exercises.plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['bcm_business_impact_analyses', 'bcm_recovery_procedures', 'bcm_exercises'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.bcm_business_impact_analyses, compliance.bcm_recovery_procedures, compliance.bcm_exercises
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.bcm_business_impact_analyses, compliance.bcm_recovery_procedures, compliance.bcm_exercises
  TO service_role;
