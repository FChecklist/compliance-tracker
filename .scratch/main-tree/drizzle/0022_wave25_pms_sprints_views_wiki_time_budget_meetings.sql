-- Wave 25 (VERIDIAN AI PMS, part 2/2): sprints, saved views, wiki, time
-- tracking, budgeting, meetings. See 0021_wave25_... for the enums,
-- enablement table, and core issue-tracking tables this depends on.

DO $$ BEGIN
  CREATE TYPE compliance.pms_sprint_status AS ENUM ('planned', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.pms_view_access AS ENUM ('private', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.pms_budget_line_kind AS ENUM ('labor', 'material');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Sprints
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_sprints (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  name text NOT NULL,
  goal text,
  start_date date,
  end_date date,
  status compliance.pms_sprint_status NOT NULL DEFAULT 'planned',
  progress_snapshot jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_sprint_issues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sprint_id text NOT NULL REFERENCES compliance.pms_sprints(id),
  issue_id text NOT NULL REFERENCES compliance.pms_issues(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(sprint_id, issue_id)
);

-- ============================================================
-- Saved views -- private rows enforced by a real RLS branch (not just a
-- service-layer filter), mirroring module_rule_configs' own
-- scope_type='user' policy precedent from Wave 21.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_saved_views (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text REFERENCES compliance.projects(id),
  owned_by_id text NOT NULL REFERENCES compliance.users(id),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  access compliance.pms_view_access NOT NULL DEFAULT 'private',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- Wiki -- deliberately separate from the existing `documents` table, which
-- is compliance-coupled (complianceItemId/noticeId FKs). Plain
-- text/markdown, no CRDT editor (explicit out-of-scope).
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_wiki_pages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  parent_page_id text REFERENCES compliance.pms_wiki_pages(id),
  slug text NOT NULL,
  title text NOT NULL,
  content text,
  version integer NOT NULL DEFAULT 1,
  updated_by_id text REFERENCES compliance.users(id),
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(project_id, slug)
);

-- ============================================================
-- Time tracking + billable rates (OpenProject's unique contribution)
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_time_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  issue_id text NOT NULL REFERENCES compliance.pms_issues(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  hours numeric NOT NULL,
  spent_on date NOT NULL,
  activity_type text,
  comments text,
  is_running boolean NOT NULL DEFAULT false,
  started_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_billable_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  user_id text REFERENCES compliance.users(id),
  hourly_rate numeric NOT NULL,
  valid_from date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- Budgeting (OpenProject's unique contribution) -- actuals are computed by
-- summing linked pms_time_entries x pms_billable_rates at read time in the
-- service layer, never a duplicated/stored ledger.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_budgets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  name text NOT NULL,
  fixed_date date,
  author_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_budget_line_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  budget_id text NOT NULL REFERENCES compliance.pms_budgets(id),
  kind compliance.pms_budget_line_kind NOT NULL,
  user_id text REFERENCES compliance.users(id),
  description text,
  amount numeric NOT NULL,
  hours numeric,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- Meetings (OpenProject's unique contribution) -- project-scoped meetings
-- with structured agenda items and outcomes/minutes.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.pms_meetings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  project_id text NOT NULL REFERENCES compliance.projects(id),
  title text NOT NULL,
  scheduled_at timestamp NOT NULL,
  duration_minutes integer,
  recurrence_rule text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_meeting_agenda_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id text NOT NULL REFERENCES compliance.pms_meetings(id),
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  issue_id text REFERENCES compliance.pms_issues(id),
  duration_minutes integer
);

CREATE TABLE IF NOT EXISTS compliance.pms_meeting_outcomes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id text NOT NULL REFERENCES compliance.pms_meetings(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_meeting_participants (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id text NOT NULL REFERENCES compliance.pms_meetings(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  response_status text,
  UNIQUE(meeting_id, user_id)
);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pms_sprints', 'pms_sprint_issues', 'pms_saved_views', 'pms_wiki_pages',
    'pms_time_entries', 'pms_billable_rates', 'pms_budgets', 'pms_budget_line_items',
    'pms_meetings', 'pms_meeting_agenda_items', 'pms_meeting_outcomes', 'pms_meeting_participants'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_sprints FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_sprint_issues FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_sprints s WHERE s.id = pms_sprint_issues.sprint_id AND s.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Private-vs-shared real RLS branch, mirroring module_rule_configs'
-- scope_type='user' precedent (Wave 21) rather than a service-layer-only
-- filter.
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_saved_views FOR ALL TO app_runtime
    USING (
      org_id = compliance.current_org_id()
      AND (access = 'shared' OR owned_by_id = compliance.current_user_id())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_wiki_pages FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_time_entries FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_billable_rates FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_budgets FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_budget_line_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_budgets b WHERE b.id = pms_budget_line_items.budget_id AND b.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_meetings FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_meeting_agenda_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_meetings m WHERE m.id = pms_meeting_agenda_items.meeting_id AND m.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_meeting_outcomes FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_meetings m WHERE m.id = pms_meeting_outcomes.meeting_id AND m.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_meeting_participants FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_meetings m WHERE m.id = pms_meeting_participants.meeting_id AND m.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pms_sprints', 'pms_sprint_issues', 'pms_saved_views', 'pms_wiki_pages',
    'pms_time_entries', 'pms_billable_rates', 'pms_budgets', 'pms_budget_line_items',
    'pms_meetings', 'pms_meeting_agenda_items', 'pms_meeting_outcomes', 'pms_meeting_participants'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.pms_sprints, compliance.pms_sprint_issues, compliance.pms_saved_views, compliance.pms_wiki_pages,
  compliance.pms_time_entries, compliance.pms_billable_rates, compliance.pms_budgets, compliance.pms_budget_line_items,
  compliance.pms_meetings, compliance.pms_meeting_agenda_items, compliance.pms_meeting_outcomes, compliance.pms_meeting_participants
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.pms_sprints, compliance.pms_sprint_issues, compliance.pms_saved_views, compliance.pms_wiki_pages,
  compliance.pms_time_entries, compliance.pms_billable_rates, compliance.pms_budgets, compliance.pms_budget_line_items,
  compliance.pms_meetings, compliance.pms_meeting_agenda_items, compliance.pms_meeting_outcomes, compliance.pms_meeting_participants
  TO service_role;

-- ============================================================
-- Covering indexes on every FK
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pms_sprints_org_id ON compliance.pms_sprints(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_sprints_project_id ON compliance.pms_sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_sprint_issues_sprint_id ON compliance.pms_sprint_issues(sprint_id);
CREATE INDEX IF NOT EXISTS idx_pms_sprint_issues_issue_id ON compliance.pms_sprint_issues(issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_saved_views_org_id ON compliance.pms_saved_views(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_saved_views_project_id ON compliance.pms_saved_views(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_saved_views_owned_by_id ON compliance.pms_saved_views(owned_by_id);
CREATE INDEX IF NOT EXISTS idx_pms_wiki_pages_org_id ON compliance.pms_wiki_pages(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_wiki_pages_project_id ON compliance.pms_wiki_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_wiki_pages_parent_page_id ON compliance.pms_wiki_pages(parent_page_id);
CREATE INDEX IF NOT EXISTS idx_pms_wiki_pages_updated_by_id ON compliance.pms_wiki_pages(updated_by_id);
CREATE INDEX IF NOT EXISTS idx_pms_time_entries_org_id ON compliance.pms_time_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_time_entries_issue_id ON compliance.pms_time_entries(issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_time_entries_user_id ON compliance.pms_time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_pms_billable_rates_org_id ON compliance.pms_billable_rates(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_billable_rates_user_id ON compliance.pms_billable_rates(user_id);
CREATE INDEX IF NOT EXISTS idx_pms_budgets_org_id ON compliance.pms_budgets(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_budgets_project_id ON compliance.pms_budgets(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_budgets_author_id ON compliance.pms_budgets(author_id);
CREATE INDEX IF NOT EXISTS idx_pms_budget_line_items_budget_id ON compliance.pms_budget_line_items(budget_id);
CREATE INDEX IF NOT EXISTS idx_pms_budget_line_items_user_id ON compliance.pms_budget_line_items(user_id);
CREATE INDEX IF NOT EXISTS idx_pms_meetings_org_id ON compliance.pms_meetings(org_id);
CREATE INDEX IF NOT EXISTS idx_pms_meetings_project_id ON compliance.pms_meetings(project_id);
CREATE INDEX IF NOT EXISTS idx_pms_meeting_agenda_items_meeting_id ON compliance.pms_meeting_agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_pms_meeting_agenda_items_issue_id ON compliance.pms_meeting_agenda_items(issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_meeting_outcomes_meeting_id ON compliance.pms_meeting_outcomes(meeting_id);
CREATE INDEX IF NOT EXISTS idx_pms_meeting_participants_meeting_id ON compliance.pms_meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_pms_meeting_participants_user_id ON compliance.pms_meeting_participants(user_id);
