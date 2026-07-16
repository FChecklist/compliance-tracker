-- VERIDIAN Review Framework remediation, Wave B: HR Attendance & Manpower
-- (2026-07-17). Real gap re-confirmed by a fresh grep of src/ before writing
-- this: the only existing "attendance" concept is construction_attendance
-- (PROJEXA's project-scoped site-labour roster tracking) -- a distinct
-- concept, not touched here. There was no general, org-wide, per-employee-
-- per-day attendance table for office staff. See schema.ts's own comment
-- immediately above hrAttendanceRecords/hrHolidays for the full design
-- rationale (status model, employee-linkage convention, why holidays is
-- org-wide only).
--
-- CLEANUP, same migration: this repo's own ACTIVE-CLAIMS.yaml records an
-- earlier "HR Attendance & Manpower" claim (2026-07-16) that never produced
-- a branch, commit, or PR -- it silently died. Before writing a single line
-- of this migration, list_tables against this live project (pcrjmlpuqsbocqfwoxod)
-- was checked fresh and found that dead session HAD reached the database
-- directly (compliance.hr_attendance + compliance.hr_timesheet_entries +
-- a compliance.hr_timesheet_approval_status enum all already existed live),
-- despite zero trace in git -- no schema.ts entry, no migration file, no
-- module_registry row, no PR, 0 rows in either table. Per this effort's own
-- established rule (verify abandoned state yourself, don't resume it
-- blindly, build fresh): confirmed via grep across drizzle/*.sql and src/
-- that nothing anywhere references these two identifiers, then dropped them
-- here rather than leaving live-DB-only orphans for a future session to
-- trip over. compliance.hr_attendance_status (the enum) is NOT dropped --
-- its 5 values (present/absent/half_day/on_leave/holiday) happen to exactly
-- match what this migration independently designed, so it's reused as-is
-- for hrAttendanceRecords below instead of dropped and recreated.
DROP TABLE IF EXISTS compliance.hr_timesheet_entries;
DROP TABLE IF EXISTS compliance.hr_attendance;
DROP TYPE IF EXISTS compliance.hr_timesheet_approval_status;

DO $$ BEGIN
  CREATE TYPE compliance.hr_attendance_status AS ENUM ('present', 'absent', 'half_day', 'on_leave', 'holiday');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.hr_attendance_records (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  company_id text,
  user_id text NOT NULL REFERENCES compliance.users(id),
  date date NOT NULL,
  status compliance.hr_attendance_status NOT NULL DEFAULT 'present',
  check_in_at timestamp,
  check_out_at timestamp,
  hours_worked numeric,
  leave_request_id text REFERENCES compliance.leave_requests(id),
  marked_by_id text NOT NULL REFERENCES compliance.users(id),
  source text NOT NULL DEFAULT 'self',
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id, date)
);

CREATE TABLE IF NOT EXISTS compliance.hr_holidays (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  date date NOT NULL,
  name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, date)
);

ALTER TABLE compliance.hr_attendance_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.hr_attendance_records FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_hr_attendance_records ON compliance.hr_attendance_records FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.hr_attendance_records TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.hr_attendance_records TO service_role;

ALTER TABLE compliance.hr_holidays ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.hr_holidays FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_hr_holidays ON compliance.hr_holidays FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.hr_holidays TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.hr_holidays TO service_role;

CREATE INDEX IF NOT EXISTS idx_hr_attendance_records_org_id ON compliance.hr_attendance_records(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_records_user_id ON compliance.hr_attendance_records(user_id);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_records_date ON compliance.hr_attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_hr_holidays_org_id ON compliance.hr_holidays(org_id);
CREATE INDEX IF NOT EXISTS idx_hr_holidays_date ON compliance.hr_holidays(date);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('hr_attendance_records', 'Employee Attendance', 'hr_attendance_records', 'hr', 'TOOLS', false, 'Org-wide per-employee per-day attendance (present/absent/half-day/leave/holiday), distinct from construction_attendance (PROJEXA site-labour)'),
  ('hr_holidays', 'Holiday Calendar', 'hr_holidays', 'hr', 'TOOLS', false, 'Org-wide declared holiday dates used to compute attendance working-day denominators')
ON CONFLICT (module_key) DO NOTHING;
