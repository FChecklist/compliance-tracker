-- Construction Intelligence, Wave 116 (2026-07-08): Manpower/Attendance +
-- Schedule/Gantt column. Second of 5 waves building the PROJEXA construction
-- modules inside VERIDIAN AI OS. Purely additive: two new tables plus two
-- new nullable/defaulted columns on existing pms_issues/pms_issue_relations
-- (every non-construction org leaves them at 0/null, unused).

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.construction_attendance_status AS ENUM ('present', 'absent', 'half_day');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Additive columns on existing tables
-- ============================================================
ALTER TABLE compliance.pms_issues ADD COLUMN IF NOT EXISTS completion_percentage integer NOT NULL DEFAULT 0;
ALTER TABLE compliance.pms_issue_relations ADD COLUMN IF NOT EXISTS lag_days integer;

-- ============================================================
-- 3. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.construction_labour_roster (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  trade text,
  skill_level text,
  vendor_id text,
  daily_rate numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_attendance (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  roster_id text NOT NULL,
  attendance_date date NOT NULL,
  status compliance.construction_attendance_status NOT NULL DEFAULT 'present',
  hours_worked numeric,
  daily_cost numeric NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT construction_attendance_roster_date_unique UNIQUE (roster_id, attendance_date)
);

-- ============================================================
-- 4. Row Level Security
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['construction_labour_roster', 'construction_attendance']
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_tenant_isolation ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
