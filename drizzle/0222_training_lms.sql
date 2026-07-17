-- VERIDIAN Review Framework remediation, Wave B: Training / LMS module
-- (2026-07-17). Real gap re-confirmed by a fresh grep of src/ before writing
-- this: zero LMS/course/assessment/curriculum data model existed anywhere.
-- See schema.ts's own header comment immediately above trainingCourses for
-- the full design rationale (role/department targeting, document-attachment
-- reuse, why trainingLessonProgress exists).
--
-- CLEANUP, same migration: this repo's own ACTIVE-CLAIMS.yaml records an
-- earlier "Training LMS module" claim (2026-07-16) that never produced a
-- branch, commit, or PR -- it silently died. Before writing a single line of
-- this migration, list_tables/execute_sql against this live project
-- (pcrjmlpuqsbocqfwoxod) were checked fresh and found that dead session HAD
-- reached the database directly: 11 compliance.training_* tables + 4 enums
-- all already existed live (FORCE RLS already applied), despite zero trace
-- in git -- no schema.ts entry, no migration file, no module_registry row,
-- no PR. Confirmed via execute_sql that all 11 tables were genuinely empty
-- (0 rows each) and via grep across drizzle/*.sql and src/ that nothing
-- anywhere references any of these table/type names. Per this effort's own
-- established rule (verify abandoned state yourself, don't resume it
-- blindly, build fresh): the live objects are dropped here and recreated
-- with an independently-designed, tracked schema (adds
-- training_lesson_progress, absent from the dead session's live design;
-- renames the lesson content-type enum values to text/video/document to
-- match this module's own written spec) rather than adopting undocumented
-- live drift as-is.
DROP TABLE IF EXISTS compliance.training_path_assignments;
DROP TABLE IF EXISTS compliance.training_path_courses;
DROP TABLE IF EXISTS compliance.training_paths;
DROP TABLE IF EXISTS compliance.training_completions;
DROP TABLE IF EXISTS compliance.training_assessment_attempts;
DROP TABLE IF EXISTS compliance.training_enrollments;
DROP TABLE IF EXISTS compliance.training_questions;
DROP TABLE IF EXISTS compliance.training_assessments;
DROP TABLE IF EXISTS compliance.training_lessons;
DROP TABLE IF EXISTS compliance.training_modules;
DROP TABLE IF EXISTS compliance.training_courses;
DROP TYPE IF EXISTS compliance.training_enrollment_status;
DROP TYPE IF EXISTS compliance.training_question_type;
DROP TYPE IF EXISTS compliance.training_lesson_content_type;
DROP TYPE IF EXISTS compliance.training_course_status;

CREATE TYPE compliance.training_course_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE compliance.training_lesson_content_type AS ENUM ('text', 'video', 'document');
CREATE TYPE compliance.training_question_type AS ENUM ('multiple_choice', 'true_false', 'short_answer');
CREATE TYPE compliance.training_progress_status AS ENUM ('not_started', 'in_progress', 'completed');

CREATE TABLE IF NOT EXISTS compliance.training_courses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  title text NOT NULL,
  description text,
  category text,
  is_mandatory boolean NOT NULL DEFAULT false,
  target_role text,
  target_department_id text,
  estimated_duration_minutes integer,
  status compliance.training_course_status NOT NULL DEFAULT 'draft',
  passing_score_percent integer NOT NULL DEFAULT 70,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_modules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  course_id text NOT NULL REFERENCES compliance.training_courses(id),
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_lessons (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  module_id text NOT NULL REFERENCES compliance.training_modules(id),
  course_id text NOT NULL REFERENCES compliance.training_courses(id),
  title text NOT NULL,
  content_type compliance.training_lesson_content_type NOT NULL DEFAULT 'text',
  content text,
  video_url text,
  sort_order integer NOT NULL DEFAULT 0,
  estimated_duration_minutes integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_lesson_progress (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  enrollment_id text NOT NULL,
  lesson_id text NOT NULL REFERENCES compliance.training_lessons(id),
  employee_id text NOT NULL REFERENCES compliance.users(id),
  status compliance.training_progress_status NOT NULL DEFAULT 'not_started',
  started_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(enrollment_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS compliance.training_assessments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  course_id text NOT NULL REFERENCES compliance.training_courses(id),
  module_id text REFERENCES compliance.training_modules(id),
  title text NOT NULL,
  description text,
  passing_score_percent integer,
  max_attempts integer,
  time_limit_minutes integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_questions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  assessment_id text NOT NULL REFERENCES compliance.training_assessments(id),
  question_text text NOT NULL,
  question_type compliance.training_question_type NOT NULL DEFAULT 'multiple_choice',
  options jsonb NOT NULL DEFAULT '[]',
  correct_answer jsonb NOT NULL,
  points integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_enrollments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  employee_id text NOT NULL REFERENCES compliance.users(id),
  course_id text NOT NULL REFERENCES compliance.training_courses(id),
  training_path_id text REFERENCES compliance.training_paths(id),
  status compliance.training_progress_status NOT NULL DEFAULT 'not_started',
  enrolled_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  due_date date,
  assigned_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, employee_id, course_id)
);

CREATE TABLE IF NOT EXISTS compliance.training_assessment_attempts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  assessment_id text NOT NULL REFERENCES compliance.training_assessments(id),
  enrollment_id text NOT NULL REFERENCES compliance.training_enrollments(id),
  employee_id text NOT NULL REFERENCES compliance.users(id),
  attempt_number integer NOT NULL DEFAULT 1,
  submitted_answers jsonb NOT NULL DEFAULT '{}',
  score numeric NOT NULL,
  max_score numeric NOT NULL,
  score_percent numeric NOT NULL,
  passed boolean NOT NULL,
  passing_threshold_applied integer NOT NULL,
  started_at timestamp NOT NULL DEFAULT now(),
  submitted_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_completions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  enrollment_id text NOT NULL UNIQUE REFERENCES compliance.training_enrollments(id),
  certificate_code text NOT NULL,
  completed_at timestamp NOT NULL DEFAULT now(),
  score numeric,
  passed boolean NOT NULL DEFAULT true,
  best_attempt_id text REFERENCES compliance.training_assessment_attempts(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_paths (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  description text,
  target_department_id text,
  target_role text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Deferred FK: training_enrollments.training_path_id references this table,
-- but training_enrollments is created earlier above (courses must exist
-- before enrollments can). Postgres allows forward-declared FKs within the
-- same transaction only if the referenced table already exists by the time
-- the constraint is added -- training_paths is created after
-- training_enrollments here, so add that FK now instead.
ALTER TABLE compliance.training_enrollments
  ADD CONSTRAINT training_enrollments_training_path_id_fkey
  FOREIGN KEY (training_path_id) REFERENCES compliance.training_paths(id);

CREATE TABLE IF NOT EXISTS compliance.training_path_courses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  training_path_id text NOT NULL REFERENCES compliance.training_paths(id),
  course_id text NOT NULL REFERENCES compliance.training_courses(id),
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(training_path_id, course_id)
);

CREATE TABLE IF NOT EXISTS compliance.training_path_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  training_path_id text NOT NULL REFERENCES compliance.training_paths(id),
  employee_id text NOT NULL REFERENCES compliance.users(id),
  assigned_via text NOT NULL DEFAULT 'individual',
  assigned_via_department_id text,
  assigned_via_role text,
  assigned_by_id text NOT NULL REFERENCES compliance.users(id),
  assigned_at timestamp NOT NULL DEFAULT now(),
  due_date date
);

-- Wave A (2026-07-16/17) established FORCE ROW LEVEL SECURITY as the
-- correct posture for every org-scoped table in this schema, applied from
-- the start for these brand-new tables.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'training_courses', 'training_modules', 'training_lessons',
    'training_lesson_progress', 'training_assessments', 'training_questions',
    'training_enrollments', 'training_assessment_attempts',
    'training_completions', 'training_paths', 'training_path_courses',
    'training_path_assignments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE compliance.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.%I', tbl);
    EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', tbl);
    EXECUTE format('DROP POLICY IF EXISTS service_role_bypass_%I ON compliance.%I', tbl, tbl);
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', tbl, tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO app_runtime', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO service_role', tbl);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_training_courses_org_id ON compliance.training_courses(org_id);
CREATE INDEX IF NOT EXISTS idx_training_courses_status ON compliance.training_courses(status);
CREATE INDEX IF NOT EXISTS idx_training_modules_org_id ON compliance.training_modules(org_id);
CREATE INDEX IF NOT EXISTS idx_training_modules_course_id ON compliance.training_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_training_lessons_org_id ON compliance.training_lessons(org_id);
CREATE INDEX IF NOT EXISTS idx_training_lessons_module_id ON compliance.training_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_training_lessons_course_id ON compliance.training_lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_training_lesson_progress_org_id ON compliance.training_lesson_progress(org_id);
CREATE INDEX IF NOT EXISTS idx_training_lesson_progress_enrollment_id ON compliance.training_lesson_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_training_lesson_progress_employee_id ON compliance.training_lesson_progress(employee_id);
CREATE INDEX IF NOT EXISTS idx_training_assessments_org_id ON compliance.training_assessments(org_id);
CREATE INDEX IF NOT EXISTS idx_training_assessments_course_id ON compliance.training_assessments(course_id);
CREATE INDEX IF NOT EXISTS idx_training_assessments_module_id ON compliance.training_assessments(module_id);
CREATE INDEX IF NOT EXISTS idx_training_questions_org_id ON compliance.training_questions(org_id);
CREATE INDEX IF NOT EXISTS idx_training_questions_assessment_id ON compliance.training_questions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_org_id ON compliance.training_enrollments(org_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_employee_id ON compliance.training_enrollments(employee_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_course_id ON compliance.training_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_training_path_id ON compliance.training_enrollments(training_path_id);
CREATE INDEX IF NOT EXISTS idx_training_assessment_attempts_org_id ON compliance.training_assessment_attempts(org_id);
CREATE INDEX IF NOT EXISTS idx_training_assessment_attempts_assessment_id ON compliance.training_assessment_attempts(assessment_id);
CREATE INDEX IF NOT EXISTS idx_training_assessment_attempts_enrollment_id ON compliance.training_assessment_attempts(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_training_completions_org_id ON compliance.training_completions(org_id);
CREATE INDEX IF NOT EXISTS idx_training_paths_org_id ON compliance.training_paths(org_id);
CREATE INDEX IF NOT EXISTS idx_training_path_courses_org_id ON compliance.training_path_courses(org_id);
CREATE INDEX IF NOT EXISTS idx_training_path_courses_training_path_id ON compliance.training_path_courses(training_path_id);
CREATE INDEX IF NOT EXISTS idx_training_path_assignments_org_id ON compliance.training_path_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_training_path_assignments_training_path_id ON compliance.training_path_assignments(training_path_id);
CREATE INDEX IF NOT EXISTS idx_training_path_assignments_employee_id ON compliance.training_path_assignments(employee_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('training_courses', 'Training Courses', 'training_courses', 'hr', 'TOOLS', false, 'Course/curriculum catalog entry -- title, category, mandatory/optional flag, target role/department, passing score'),
  ('training_paths', 'Training Curricula', 'training_paths', 'hr', 'TOOLS', false, 'Ordered sequence of courses (learning path) assigned to a role or department')
ON CONFLICT (module_key) DO NOTHING;

-- Asset Registry Coverage Check (GAP-UMR-TABLE-COVERAGE): training_courses
-- and training_paths are genuine, discoverable platform business records
-- (same class as clients/erp_customers) -- registered. The other 10 tables
-- are either pure join/config tables (training_modules, training_lessons,
-- training_path_courses -- ordered content units and path membership, no
-- independent identity a user would browse in a registry) or per-employee
-- transactional/log rows (training_lesson_progress, training_questions,
-- training_enrollments, training_assessment_attempts, training_completions,
-- training_assessments, training_path_assignments -- same class as
-- crm_stage_history/hr_attendance_records: no genuine display-name column
-- of their own) -- all exempted, see
-- ai-os/registry/asset-registry-coverage.yaml for the per-table reasoning.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('training_courses', 'other', 'title', 'description', NULL, 'org_id', 'created_by_id', NULL),
  ('training_paths', 'other', 'name', 'description', NULL, 'org_id', 'created_by_id', 'is_active')
ON CONFLICT (source_table) DO NOTHING;

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_courses
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_paths
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
