-- Wave 25 (VERIDIAN AI PMS, part 1/2): org-branch enablement + core issue
-- tracking schema. Adapted from studying hcengineering/platform (Huly),
-- opf/openproject, makeplane/plane -- never their code, never their AI.
-- See PLATFORM_STRATEGY.md §14 for the full research and design record.

-- ============================================================
-- Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.pms_issue_priority AS ENUM ('no_priority', 'urgent', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'triage' absorbs Plane's intake-queue concept -- no separate table needed.
DO $$ BEGIN
  CREATE TYPE compliance.pms_status_group AS ENUM ('backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.pms_issue_relation_type AS ENUM ('blocks', 'blocked_by', 'duplicates', 'relates_to');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.pms_milestone_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Org adoption of a product branch -- the missing table product_branches /
-- product_branch_modules (Wave 20, pure global catalog) never needed until
-- now: "which orgs turned which branch on." Explicit row-per-org-branch
-- (not "row absence = disabled") so the audit trail survives a
-- disable-then-reenable cycle.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.org_product_branch_enablements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  product_branch_id text NOT NULL REFERENCES compliance.product_branches(id),
  is_enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamp,
  enabled_by_id text REFERENCES compliance.users(id),
  disabled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, product_branch_id)
);

ALTER TABLE compliance.org_product_branch_enablements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.org_product_branch_enablements FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_org_product_branch_enablements ON compliance.org_product_branch_enablements FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.org_product_branch_enablements TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.org_product_branch_enablements TO service_role;

CREATE INDEX IF NOT EXISTS idx_org_product_branch_enablements_org_id ON compliance.org_product_branch_enablements(org_id);
CREATE INDEX IF NOT EXISTS idx_org_product_branch_enablements_branch_id ON compliance.org_product_branch_enablements(product_branch_id);

-- New product branch: VERIDIAN's first genuine second row since 'grc'.
INSERT INTO compliance.product_branches (branch_key, display_name, domain, description) VALUES
  ('pms', 'VERIDIAN AI PMS', 'project_management', 'Project Management System -- issues, sprints, wiki, time/budget, meetings. Separate, opt-in, disabled by default for existing GRC orgs.')
ON CONFLICT (branch_key) DO NOTHING;

-- ============================================================
-- Wave 19's projects table gains additive PM columns -- every pre-existing
-- GRC-only project simply leaves these null/default; no PM behavior is
-- implied until an org actually uses this project for PMS work.
-- ============================================================
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS issue_prefix text;
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS issue_sequence integer NOT NULL DEFAULT 0;
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS lead_user_id text REFERENCES compliance.users(id);
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS target_date date;
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS health_status text;
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS parent_project_id text REFERENCES compliance.projects(id);

CREATE INDEX IF NOT EXISTS idx_projects_lead_user_id ON compliance.projects(lead_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_parent_project_id ON compliance.projects(parent_project_id);

-- ============================================================
-- Core taxonomy: issue types (org-wide), issue statuses (per-project),
-- workflow transitions. Copy-on-enable seeding -- enabling PMS for an org
-- creates real, org-owned default rows here (see pms-enablement-service.ts,
-- Wave 26), not a live-resolved platform catalog.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_issue_types (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  icon text,
  color text,
  is_epic boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_issue_statuses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  name text NOT NULL,
  "group" compliance.pms_status_group NOT NULL,
  color text,
  position integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Optional per-type/per-role transition constraint (OpenProject's unique
-- contribution). `role` reuses the existing user_role enum -- no roles
-- table exists in this schema and none is created here.
CREATE TABLE IF NOT EXISTS compliance.pms_workflow_transitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  issue_type_id text NOT NULL REFERENCES compliance.pms_issue_types(id),
  role compliance.user_role,
  from_status_id text NOT NULL REFERENCES compliance.pms_issue_statuses(id),
  to_status_id text NOT NULL REFERENCES compliance.pms_issue_statuses(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_estimate_schemes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_estimate_points (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scheme_id text NOT NULL REFERENCES compliance.pms_estimate_schemes(id),
  value text NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance.pms_milestones (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  name text NOT NULL,
  description text,
  status compliance.pms_milestone_status NOT NULL DEFAULT 'planned',
  target_date date,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- Core issues
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_issues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  type_id text NOT NULL REFERENCES compliance.pms_issue_types(id),
  status_id text NOT NULL REFERENCES compliance.pms_issue_statuses(id),
  priority compliance.pms_issue_priority NOT NULL DEFAULT 'no_priority',
  number integer NOT NULL,
  title text NOT NULL,
  description text,
  assignee_id text REFERENCES compliance.users(id),
  parent_issue_id text REFERENCES compliance.pms_issues(id),
  milestone_id text REFERENCES compliance.pms_milestones(id),
  estimate_point_id text REFERENCES compliance.pms_estimate_points(id),
  start_date date,
  due_date date,
  position numeric NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_by_id text REFERENCES compliance.users(id),
  assigned_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(project_id, number)
);

CREATE TABLE IF NOT EXISTS compliance.pms_issue_assignees (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  issue_id text NOT NULL REFERENCES compliance.pms_issues(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(issue_id, user_id)
);

CREATE TABLE IF NOT EXISTS compliance.pms_issue_relations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  issue_id text NOT NULL REFERENCES compliance.pms_issues(id),
  related_issue_id text NOT NULL REFERENCES compliance.pms_issues(id),
  relation_type compliance.pms_issue_relation_type NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(issue_id, related_issue_id, relation_type)
);

CREATE TABLE IF NOT EXISTS compliance.pms_labels (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  name text NOT NULL,
  color text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_issue_labels (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  issue_id text NOT NULL REFERENCES compliance.pms_issues(id),
  label_id text NOT NULL REFERENCES compliance.pms_labels(id),
  UNIQUE(issue_id, label_id)
);

-- ============================================================
-- RLS: standard app_runtime_org_scoped + service_role_bypass for every
-- org-scoped table above.
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pms_issue_types', 'pms_issue_statuses', 'pms_workflow_transitions',
    'pms_estimate_schemes', 'pms_estimate_points', 'pms_milestones',
    'pms_issues', 'pms_issue_assignees', 'pms_issue_relations',
    'pms_labels', 'pms_issue_labels'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- pms_estimate_points/pms_issue_assignees/pms_issue_labels have no direct
-- org_id column -- scoped via their parent's org_id through a join.
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_issue_types FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_issue_statuses FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_workflow_transitions FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_estimate_schemes FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_estimate_points FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_estimate_schemes s WHERE s.id = pms_estimate_points.scheme_id AND s.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_milestones FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_issues FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_issue_assignees FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_issues i WHERE i.id = pms_issue_assignees.issue_id AND i.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_issue_relations FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_labels FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_issue_labels FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_issues i WHERE i.id = pms_issue_labels.issue_id AND i.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pms_issue_types', 'pms_issue_statuses', 'pms_workflow_transitions',
    'pms_estimate_schemes', 'pms_estimate_points', 'pms_milestones',
    'pms_issues', 'pms_issue_assignees', 'pms_issue_relations',
    'pms_labels', 'pms_issue_labels'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.pms_issue_types, compliance.pms_issue_statuses, compliance.pms_workflow_transitions,
  compliance.pms_estimate_schemes, compliance.pms_estimate_points, compliance.pms_milestones,
  compliance.pms_issues, compliance.pms_issue_assignees, compliance.pms_issue_relations,
  compliance.pms_labels, compliance.pms_issue_labels
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.pms_issue_types, compliance.pms_issue_statuses, compliance.pms_workflow_transitions,
  compliance.pms_estimate_schemes, compliance.pms_estimate_points, compliance.pms_milestones,
  compliance.pms_issues, compliance.pms_issue_assignees, compliance.pms_issue_relations,
  compliance.pms_labels, compliance.pms_issue_labels
  TO service_role;

-- ============================================================
-- Covering indexes on every FK
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pms_issue_types_org_id ON compliance.pms_issue_types(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_statuses_org_id ON compliance.pms_issue_statuses(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_statuses_project_id ON compliance.pms_issue_statuses(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_workflow_transitions_org_id ON compliance.pms_workflow_transitions(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_workflow_transitions_issue_type_id ON compliance.pms_workflow_transitions(issue_type_id);
CREATE INDEX IF NOT EXISTS idx_pms_workflow_transitions_from_status_id ON compliance.pms_workflow_transitions(from_status_id);
CREATE INDEX IF NOT EXISTS idx_pms_workflow_transitions_to_status_id ON compliance.pms_workflow_transitions(to_status_id);
CREATE INDEX IF NOT EXISTS idx_pms_estimate_schemes_org_id ON compliance.pms_estimate_schemes(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_estimate_schemes_project_id ON compliance.pms_estimate_schemes(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_estimate_points_scheme_id ON compliance.pms_estimate_points(scheme_id);
CREATE INDEX IF NOT EXISTS idx_pms_milestones_org_id ON compliance.pms_milestones(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_milestones_project_id ON compliance.pms_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_org_id ON compliance.pms_issues(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_client_id ON compliance.pms_issues(client_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_project_id ON compliance.pms_issues(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_type_id ON compliance.pms_issues(type_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_status_id ON compliance.pms_issues(status_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_assignee_id ON compliance.pms_issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_parent_issue_id ON compliance.pms_issues(parent_issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_milestone_id ON compliance.pms_issues(milestone_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_estimate_point_id ON compliance.pms_issues(estimate_point_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_created_by_id ON compliance.pms_issues(created_by_id);
CREATE INDEX IF NOT EXISTS idx_pms_issues_assigned_by_id ON compliance.pms_issues(assigned_by_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_assignees_issue_id ON compliance.pms_issue_assignees(issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_assignees_user_id ON compliance.pms_issue_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_relations_org_id ON compliance.pms_issue_relations(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_relations_issue_id ON compliance.pms_issue_relations(issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_relations_related_issue_id ON compliance.pms_issue_relations(related_issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_labels_org_id ON compliance.pms_labels(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_labels_project_id ON compliance.pms_labels(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_labels_issue_id ON compliance.pms_issue_labels(issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_issue_labels_label_id ON compliance.pms_issue_labels(label_id);

-- ============================================================
-- Module Registry seed: 7 new PMS modules, domain='project_management',
-- isCore=false, linked to the 'pms' branch only (NOT 'grc' -- this is the
-- whole point of the opt-in separation).
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('pms_issues', 'Issue Tracking', 'pms_issues', 'project_management', 'PMS', false, 'Issues, sub-issues, sprints board, saved views'),
  ('pms_sprints', 'Sprints', 'pms_sprints', 'project_management', 'PMS', false, 'Time-boxed sprint planning and burndown'),
  ('pms_wiki_pages', 'Project Wiki', 'pms_wiki_pages', 'project_management', 'PMS', false, 'Project documentation pages'),
  ('pms_time_entries', 'Time Tracking', 'pms_time_entries', 'project_management', 'PMS', false, 'Time logging and billable rates'),
  ('pms_budgets', 'Budgeting', 'pms_budgets', 'project_management', 'PMS', false, 'Project budgets and line items'),
  ('pms_meetings', 'Meetings', 'pms_meetings', 'project_management', 'PMS', false, 'Project meetings, agendas, outcomes'),
  ('pms_saved_views', 'Saved Views', 'pms_saved_views', 'project_management', 'PMS', false, 'Saved filter/sort/display configurations')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'pms'
  AND mr.module_key IN ('pms_issues', 'pms_sprints', 'pms_wiki_pages', 'pms_time_entries', 'pms_budgets', 'pms_meetings', 'pms_saved_views')
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
