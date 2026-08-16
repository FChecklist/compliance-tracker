-- Wave 62: Recruitment/ATS + Performance Appraisal (Tier 3 #14). Complete
-- gaps before this wave -- HR (Wave 40) has employee master data and
-- leave, but no hiring pipeline and no review cycle. Candidate resumes
-- deliberately get no new file column -- a candidate is just another
-- linked_entity_type='candidate' row in the Wave 61 central documents
-- repository. Hiring an application does NOT auto-provision a
-- users/employee_profiles row -- same "no silent auto-provisioning"
-- discipline as Wave 59's SSO.

DO $$ BEGIN
  CREATE TYPE compliance.job_opening_status AS ENUM ('open', 'on_hold', 'closed', 'filled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.application_stage AS ENUM ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.interview_recommendation AS ENUM ('strong_yes', 'yes', 'no', 'strong_no');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.performance_review_cycle_status AS ENUM ('draft', 'active', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.performance_review_status AS ENUM ('pending', 'submitted', 'acknowledged');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.job_openings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  title text NOT NULL,
  department_id text REFERENCES compliance.departments(id),
  job_description text,
  employment_type text NOT NULL DEFAULT 'full_time',
  num_positions integer NOT NULL DEFAULT 1,
  status compliance.job_opening_status NOT NULL DEFAULT 'open',
  posted_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  closed_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.candidates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  source text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.job_applications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  job_opening_id text NOT NULL REFERENCES compliance.job_openings(id),
  candidate_id text NOT NULL REFERENCES compliance.candidates(id),
  stage compliance.application_stage NOT NULL DEFAULT 'applied',
  rejected_reason text,
  offer_amount numeric,
  offer_accepted_at timestamp,
  hired_employee_profile_id text REFERENCES compliance.employee_profiles(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.interview_feedback (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  application_id text NOT NULL REFERENCES compliance.job_applications(id),
  interviewer_id text NOT NULL REFERENCES compliance.users(id),
  round_name text NOT NULL,
  scheduled_at timestamp NOT NULL,
  rating integer,
  recommendation compliance.interview_recommendation,
  feedback text,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.performance_review_cycles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status compliance.performance_review_cycle_status NOT NULL DEFAULT 'draft',
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.performance_reviews (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  cycle_id text NOT NULL REFERENCES compliance.performance_review_cycles(id),
  employee_profile_id text NOT NULL REFERENCES compliance.employee_profiles(id),
  reviewer_id text NOT NULL REFERENCES compliance.users(id),
  self_rating integer,
  manager_rating integer,
  strengths text,
  improvements text,
  goals_for_next_period text,
  status compliance.performance_review_status NOT NULL DEFAULT 'pending',
  submitted_at timestamp,
  acknowledged_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.job_openings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.job_openings FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_job_openings ON compliance.job_openings FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.job_openings TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.job_openings TO service_role;

ALTER TABLE compliance.candidates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.candidates FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_candidates ON compliance.candidates FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.candidates TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.candidates TO service_role;

ALTER TABLE compliance.job_applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.job_applications FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_job_applications ON compliance.job_applications FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.job_applications TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.job_applications TO service_role;

ALTER TABLE compliance.interview_feedback ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.interview_feedback FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interview_feedback ON compliance.interview_feedback FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.interview_feedback TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.interview_feedback TO service_role;

ALTER TABLE compliance.performance_review_cycles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.performance_review_cycles FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_performance_review_cycles ON compliance.performance_review_cycles FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.performance_review_cycles TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.performance_review_cycles TO service_role;

ALTER TABLE compliance.performance_reviews ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.performance_reviews FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_performance_reviews ON compliance.performance_reviews FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.performance_reviews TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.performance_reviews TO service_role;

CREATE INDEX IF NOT EXISTS idx_job_openings_org_id ON compliance.job_openings(org_id);
CREATE INDEX IF NOT EXISTS idx_job_openings_department_id ON compliance.job_openings(department_id);
CREATE INDEX IF NOT EXISTS idx_candidates_org_id ON compliance.candidates(org_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_org_id ON compliance.job_applications(org_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_job_opening_id ON compliance.job_applications(job_opening_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_candidate_id ON compliance.job_applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_interview_feedback_org_id ON compliance.interview_feedback(org_id);
CREATE INDEX IF NOT EXISTS idx_interview_feedback_application_id ON compliance.interview_feedback(application_id);
CREATE INDEX IF NOT EXISTS idx_performance_review_cycles_org_id ON compliance.performance_review_cycles(org_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_org_id ON compliance.performance_reviews(org_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_cycle_id ON compliance.performance_reviews(cycle_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee_profile_id ON compliance.performance_reviews(employee_profile_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('job_openings', 'Job Openings', 'job_openings', 'hr', 'TOOLS', true, 'Recruitment requisitions -- role, department, headcount, status'),
  ('candidates', 'Candidates', 'candidates', 'hr', 'TOOLS', true, 'Candidate contact records for the hiring pipeline'),
  ('job_applications', 'Job Applications', 'job_applications', 'hr', 'TOOLS', true, 'Candidate-to-opening applications tracked through the hiring stage pipeline'),
  ('interview_feedback', 'Interview Feedback', 'interview_feedback', 'hr', 'TOOLS', true, 'Per-round interviewer ratings and recommendations on an application'),
  ('performance_review_cycles', 'Performance Review Cycles', 'performance_review_cycles', 'hr', 'TOOLS', true, 'Org-wide performance appraisal periods (e.g. H1 2026)'),
  ('performance_reviews', 'Performance Reviews', 'performance_reviews', 'hr', 'TOOLS', true, 'Per-employee per-cycle review: self/manager ratings, strengths, improvements, goals')
ON CONFLICT (module_key) DO NOTHING;
