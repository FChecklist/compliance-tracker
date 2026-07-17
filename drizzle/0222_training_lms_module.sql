-- VERIDIAN Review Framework remediation, Wave B: "Training LMS module"
-- (full depth), 2026-07-17.
--
-- ORPHANED LIVE-DB DRIFT FOUND AND RESOLVED (per this effort's standing
-- pre-flight check -- 4 of 4 prior dead-2026-07-16 claims had the same
-- pattern): an earlier, dead 2026-07-16 session ("Training LMS module")
-- already applied this exact 11-table design directly to the live Supabase
-- project (pcrjmlpuqsbocqfwoxod, schema `compliance`) via the Supabase MCP
-- -- visible as migration `training_lms_wave_b` (version 20260716123536) in
-- `list_migrations` -- with NO corresponding file ever committed to
-- drizzle/ and zero schema.ts/service/API/UI code ever written. Verified
-- directly before reusing anything (never assumed):
--   * information_schema.tables: all 11 training_* tables exist in
--     `compliance`, exactly matching the design below column-for-column.
--   * SELECT count(*) on all 11: every one is 0 rows.
--   * grep -r across src/ for every table/camelCase name: zero references.
--   * pg_class.relforcerowsecurity: all 11 already ENABLE+FORCEd.
--   * pg_policies: all 11 already carry the correct app_runtime_org_scoped
--     (org_id = compliance.current_org_id()) + service_role_bypass_* pair,
--     matching this schema's established convention exactly.
--   * pg_constraint: zero FK constraints on any of the 11 tables (matches
--     this schema's bare-text-reference convention for cross-table
--     pointers, e.g. erp_quotations.accountId).
-- Conclusion: the orphaned design is empty, unreferenced, and correctly
-- built to this codebase's own conventions -- REUSED as-is rather than
-- dropped and rebuilt. Every statement below is written IF-NOT-EXISTS /
-- idempotent, so re-running this migration against the SAME live project
-- is a safe no-op for everything that's already there; it also makes this
-- migration correct and complete for a FRESH environment that has never
-- seen any of this DDL. Two columns (training_courses.is_mandatory/
-- target_roles) and one enum value (training_lesson_content_type
-- 'document') are genuinely new -- they did not exist in the orphaned
-- live design, and are added additively here to satisfy this wave's real
-- requirements (see schema.ts's header comment on the Training/LMS
-- section for the full reasoning).

-- ─── Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE compliance.training_course_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.training_enrollment_status AS ENUM ('not_started', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.training_lesson_content_type AS ENUM ('rich_text', 'video_url');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Additive: 'document' did not exist in the orphaned live design. Lets a
-- lesson point at an existing `documents` row (linkedEntityType =
-- 'training_lesson') instead of inventing a new file-upload path.
ALTER TYPE compliance.training_lesson_content_type ADD VALUE IF NOT EXISTS 'document';

DO $$ BEGIN
  CREATE TYPE compliance.training_question_type AS ENUM ('multiple_choice', 'true_false', 'short_answer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.training_courses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  title text NOT NULL,
  description text,
  category text,
  created_by text NOT NULL,
  status compliance.training_course_status NOT NULL DEFAULT 'draft',
  passing_score_percent integer NOT NULL DEFAULT 70,
  estimated_duration_minutes integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
-- Additive columns (not in the orphaned live design -- genuinely new).
ALTER TABLE compliance.training_courses ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false;
ALTER TABLE compliance.training_courses ADD COLUMN IF NOT EXISTS target_roles jsonb;

CREATE TABLE IF NOT EXISTS compliance.training_modules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  course_id text NOT NULL,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_lessons (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  module_id text NOT NULL,
  course_id text NOT NULL,
  title text NOT NULL,
  content_type compliance.training_lesson_content_type NOT NULL DEFAULT 'rich_text',
  content text,
  video_url text,
  sort_order integer NOT NULL DEFAULT 0,
  estimated_duration_minutes integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_assessments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  course_id text NOT NULL,
  module_id text,
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
  org_id text NOT NULL,
  assessment_id text NOT NULL,
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
  org_id text NOT NULL,
  employee_id text NOT NULL,
  course_id text NOT NULL,
  training_path_id text,
  status compliance.training_enrollment_status NOT NULL DEFAULT 'not_started',
  enrolled_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  due_date date,
  assigned_by text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_assessment_attempts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  assessment_id text NOT NULL,
  enrollment_id text NOT NULL,
  employee_id text NOT NULL,
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
  org_id text NOT NULL,
  enrollment_id text NOT NULL,
  completed_at timestamp NOT NULL DEFAULT now(),
  score numeric,
  passed boolean NOT NULL DEFAULT true,
  best_attempt_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE compliance.training_completions ADD CONSTRAINT training_completions_enrollment_id_key UNIQUE (enrollment_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.training_paths (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  name text NOT NULL,
  description text,
  target_department_id text,
  target_role text,
  is_active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_path_courses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  training_path_id text NOT NULL,
  course_id text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.training_path_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  training_path_id text NOT NULL,
  employee_id text NOT NULL,
  assigned_via text NOT NULL DEFAULT 'individual',
  assigned_via_department_id text,
  assigned_via_role text,
  assigned_by text NOT NULL,
  assigned_at timestamp NOT NULL DEFAULT now(),
  due_date date
);

-- ─── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_training_courses_org_id ON compliance.training_courses(org_id);
CREATE INDEX IF NOT EXISTS idx_training_modules_org_id ON compliance.training_modules(org_id);
CREATE INDEX IF NOT EXISTS idx_training_modules_course_id ON compliance.training_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_training_lessons_org_id ON compliance.training_lessons(org_id);
CREATE INDEX IF NOT EXISTS idx_training_lessons_module_id ON compliance.training_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_training_lessons_course_id ON compliance.training_lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_training_assessments_org_id ON compliance.training_assessments(org_id);
CREATE INDEX IF NOT EXISTS idx_training_assessments_course_id ON compliance.training_assessments(course_id);
CREATE INDEX IF NOT EXISTS idx_training_assessments_module_id ON compliance.training_assessments(module_id);
CREATE INDEX IF NOT EXISTS idx_training_questions_org_id ON compliance.training_questions(org_id);
CREATE INDEX IF NOT EXISTS idx_training_questions_assessment_id ON compliance.training_questions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_org_id ON compliance.training_enrollments(org_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_employee_id ON compliance.training_enrollments(employee_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_course_id ON compliance.training_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_training_path_id ON compliance.training_enrollments(training_path_id);
DO $$ BEGIN
  CREATE UNIQUE INDEX uidx_training_enrollments_employee_course ON compliance.training_enrollments(employee_id, course_id);
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
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

-- ─── RLS: FORCE ROW LEVEL SECURITY from the start (Wave A security posture,
-- 2026-07-16/17) -- all 11 tables already carry this live via the orphaned
-- session's own apply; re-asserted here idempotently so a fresh environment
-- gets the exact same posture. ────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'training_courses', 'training_modules', 'training_lessons',
    'training_assessments', 'training_questions', 'training_enrollments',
    'training_assessment_attempts', 'training_completions', 'training_paths',
    'training_path_courses', 'training_path_assignments'
  ] LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE compliance.%I FORCE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%s ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO app_runtime', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO service_role', t);
  END LOOP;
END $$;

-- ─── Module registry ───────────────────────────────────────────────────
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('training_courses', 'Training Courses', 'training_courses', 'hr', 'TOOLS', true, 'Course/curriculum catalog entry with modules, lessons, and an optional assessment'),
  ('training_paths', 'Training Learning Paths', 'training_paths', 'hr', 'TOOLS', true, 'Ordered sequence of courses assigned to a role or department')
ON CONFLICT (module_key) DO NOTHING;

-- ─── Asset Registry Coverage Check (GAP-UMR-TABLE-COVERAGE) ────────────
-- Judgment made per-table, matching this file's own established pattern
-- (crm_leads/leave_requests registered vs crm_stage_history/
-- hr_attendance_records exempted): registered where a genuine own display-
-- name column exists and the row is real discoverable catalog/content;
-- exempted where the row is a join table, assignment/enrollment record, or
-- an append-only attempt/completion log with no name of its own (same
-- class as crm_stage_history/hr_attendance_records).
--   REGISTERED: training_courses (title), training_paths (name),
--     training_modules (title), training_lessons (title),
--     training_assessments (title), training_questions (question_text --
--     the question IS this row's own identifying content, same reasoning
--     as clm_clauses using title over body_text, adapted since this table
--     has no separate title field).
--   EXEMPTED (see ai-os/registry/asset-registry-coverage.yaml for the full
--     per-table reasoning written out): training_enrollments,
--     training_assessment_attempts, training_completions,
--     training_path_courses, training_path_assignments.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('training_courses', 'other', 'title', 'description', NULL, 'org_id', 'created_by', NULL),
  ('training_paths', 'other', 'name', 'description', NULL, 'org_id', 'created_by', 'is_active'),
  ('training_modules', 'other', 'title', 'description', NULL, 'org_id', NULL, NULL),
  ('training_lessons', 'other', 'title', NULL, NULL, 'org_id', NULL, NULL),
  ('training_assessments', 'other', 'title', 'description', NULL, 'org_id', NULL, NULL),
  ('training_questions', 'other', 'question_text', NULL, NULL, 'org_id', NULL, NULL)
ON CONFLICT (source_table) DO NOTHING;

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_courses
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_paths
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_modules
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_lessons
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_assessments
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.training_questions
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
