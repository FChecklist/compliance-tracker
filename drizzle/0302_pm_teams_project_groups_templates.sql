-- Task #47 PM gap analysis (2026-07-31): generic PM Teams grouping +
-- Project Groups/Templates. Finalized gap analysis confirmed only helpdesk
-- ticket_teams existed before this wave (see 0264_helpdesk_tiered_sla_team_routing.sql)
-- -- a narrower, single-lead, no-membership-roster, ticket-routing-specific
-- entity. pm_teams below is modeled after its shape (org-scoped, text PK,
-- is_default flag, optional lead) but is a genuinely new, decoupled table
-- with its own real membership table (pm_team_members), since ticket_teams
-- has none to extend. Hand-written, NOT drizzle-kit generate output -- see
-- 0267/0268's own headers for why drizzle-kit cannot diff this schema.
--
-- project_templates snapshots a project's structure (phases/tasks) as JSON
-- at capture time, independent of the source project's later lifecycle.
-- Cloning targets new, minimal, ungated project_phases/project_tasks tables
-- -- deliberately NOT pms_issues/pms_milestones (out of scope per this
-- task's spec, and those require the 'pms' product branch enabled plus
-- seeded issue types/statuses, which would make template cloning silently
-- fail for orgs that haven't enabled PMS).

DO $$ BEGIN
  CREATE TYPE compliance.pm_team_member_role AS ENUM ('lead', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.pm_teams (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  description text,
  lead_user_id text REFERENCES compliance.users(id),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pm_team_members (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id text NOT NULL REFERENCES compliance.pm_teams(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  role compliance.pm_team_member_role NOT NULL DEFAULT 'member',
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS compliance.project_groups (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  description text,
  color text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.project_group_projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  group_id text NOT NULL REFERENCES compliance.project_groups(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(group_id, project_id)
);

CREATE TABLE IF NOT EXISTS compliance.project_team_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  team_id text NOT NULL REFERENCES compliance.pm_teams(id),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(project_id, team_id)
);

CREATE TABLE IF NOT EXISTS compliance.project_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  description text,
  default_team_id text REFERENCES compliance.pm_teams(id),
  phases jsonb NOT NULL DEFAULT '[]',
  tasks jsonb NOT NULL DEFAULT '[]',
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.project_phases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  name text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.project_tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  phase_id text REFERENCES compliance.project_phases(id),
  title text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS: standard app_runtime_org_scoped + service_role_bypass for every
-- org-scoped table above. pm_team_members/project_group_projects have no
-- direct org_id column -- scoped via their parent's org_id through a join.
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pm_teams', 'pm_team_members', 'project_groups', 'project_group_projects',
    'project_team_assignments', 'project_templates', 'project_phases', 'project_tasks'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pm_teams FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pm_team_members FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pm_teams tm WHERE tm.id = pm_team_members.team_id AND tm.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.project_groups FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.project_group_projects FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.project_groups g WHERE g.id = project_group_projects.group_id AND g.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.project_team_assignments FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.project_templates FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.project_phases FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.project_tasks FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pm_teams', 'pm_team_members', 'project_groups', 'project_group_projects',
    'project_team_assignments', 'project_templates', 'project_phases', 'project_tasks'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.pm_teams, compliance.pm_team_members, compliance.project_groups, compliance.project_group_projects,
  compliance.project_team_assignments, compliance.project_templates, compliance.project_phases, compliance.project_tasks
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.pm_teams, compliance.pm_team_members, compliance.project_groups, compliance.project_group_projects,
  compliance.project_team_assignments, compliance.project_templates, compliance.project_phases, compliance.project_tasks
  TO service_role;

-- ============================================================
-- Covering indexes on every FK
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pm_teams_org_id ON compliance.pm_teams(org_id);
CREATE INDEX IF NOT EXISTS idx_pm_teams_lead_user_id ON compliance.pm_teams(lead_user_id);
CREATE INDEX IF NOT EXISTS idx_pm_team_members_team_id ON compliance.pm_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_pm_team_members_user_id ON compliance.pm_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_groups_org_id ON compliance.project_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_project_group_projects_group_id ON compliance.project_group_projects(group_id);
CREATE INDEX IF NOT EXISTS idx_project_group_projects_project_id ON compliance.project_group_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_project_team_assignments_org_id ON compliance.project_team_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_project_team_assignments_project_id ON compliance.project_team_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_team_assignments_team_id ON compliance.project_team_assignments(team_id);
CREATE INDEX IF NOT EXISTS idx_project_templates_org_id ON compliance.project_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_project_templates_default_team_id ON compliance.project_templates(default_team_id);
CREATE INDEX IF NOT EXISTS idx_project_phases_org_id ON compliance.project_phases(org_id);
CREATE INDEX IF NOT EXISTS idx_project_phases_project_id ON compliance.project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_org_id ON compliance.project_tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON compliance.project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_phase_id ON compliance.project_tasks(phase_id);
