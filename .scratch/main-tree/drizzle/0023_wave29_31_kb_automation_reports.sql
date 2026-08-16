-- Waves 29-31: Knowledge Base, Automation Rules, Custom Reports. Adapted
-- from studying AppFlowy/n8n/Metabase/Superset -- never their code, never
-- their AI. NocoBase/Peppermint/Mattermost were evaluated and explicitly
-- rejected. See PLATFORM_STRATEGY.md §15 for the full research and
-- decision record. All three modules are core (isCore=true, no enablement
-- toggle, always available regardless of product branch).

-- ============================================================
-- Wave 29: Knowledge Base (org-wide, AppFlowy page-hierarchy pattern)
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.knowledge_base_pages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  parent_page_id text REFERENCES compliance.knowledge_base_pages(id),
  slug text NOT NULL,
  title text NOT NULL,
  content text,
  version integer NOT NULL DEFAULT 1,
  updated_by_id text REFERENCES compliance.users(id),
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)
);

ALTER TABLE compliance.knowledge_base_pages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.knowledge_base_pages FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_knowledge_base_pages ON compliance.knowledge_base_pages FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.knowledge_base_pages TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.knowledge_base_pages TO service_role;

CREATE INDEX IF NOT EXISTS idx_knowledge_base_pages_org_id ON compliance.knowledge_base_pages(org_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_pages_parent_page_id ON compliance.knowledge_base_pages(parent_page_id);

-- ============================================================
-- Wave 30: Automation Rules (deterministic trigger->condition->action,
-- n8n-inspired shape only -- no node-graph, no AI, no code execution)
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.automation_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL,
  trigger_conditions jsonb NOT NULL DEFAULT '{}',
  action_type text NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.automation_rule_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rule_id text NOT NULL REFERENCES compliance.automation_rules(id),
  triggered_at timestamp NOT NULL DEFAULT now(),
  trigger_payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL,
  result_summary text,
  error_message text
);

ALTER TABLE compliance.automation_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.automation_rules FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_automation_rules ON compliance.automation_rules FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.automation_rules TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.automation_rules TO service_role;

-- automation_rule_runs has no org_id of its own -- scoped transitively via
-- rule_id, same pattern as pms_sprint_issues/pms_meeting_outcomes joins.
ALTER TABLE compliance.automation_rule_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.automation_rule_runs FOR ALL TO app_runtime
    USING (rule_id IN (SELECT id FROM compliance.automation_rules WHERE org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_automation_rule_runs ON compliance.automation_rule_runs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.automation_rule_runs TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.automation_rule_runs TO service_role;

CREATE INDEX IF NOT EXISTS idx_automation_rules_org_id ON compliance.automation_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger_type ON compliance.automation_rules(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automation_rule_runs_rule_id ON compliance.automation_rule_runs(rule_id);

-- ============================================================
-- Wave 31: Custom Reports (saved queries, Metabase/Superset-inspired UX
-- pattern -- no SQL editor, no BI engine, rendered with the existing
-- recharts dependency)
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.saved_reports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  description text,
  owned_by_id text NOT NULL REFERENCES compliance.users(id),
  source_entity text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  group_by_field text,
  chart_type text NOT NULL DEFAULT 'table',
  visibility text NOT NULL DEFAULT 'private',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.saved_reports ENABLE ROW LEVEL SECURITY;
-- Same scope_type='user'-equivalent branch as pms_saved_views: shared
-- reports are org-wide readable, private reports only to their owner.
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.saved_reports FOR ALL TO app_runtime
    USING (
      org_id = compliance.current_org_id()
      AND (visibility = 'shared' OR owned_by_id = compliance.current_user_id())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_saved_reports ON compliance.saved_reports FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.saved_reports TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.saved_reports TO service_role;

CREATE INDEX IF NOT EXISTS idx_saved_reports_org_id ON compliance.saved_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_saved_reports_owned_by_id ON compliance.saved_reports(owned_by_id);

-- ============================================================
-- Module Registry: register all 3 as core modules (isCore=true, always
-- available, no product-branch gating -- same posture as the original
-- pre-Wave-7 tables).
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('knowledge_base_pages', 'Knowledge Base', 'knowledge_base_pages', 'knowledge_base', 'TOOLS', true, 'Org-wide knowledge base pages, independent of any project or product branch'),
  ('automation_rules', 'Automation Rules', 'automation_rules', 'automation', 'TOOLS', true, 'Deterministic trigger-condition-action rules across compliance/PMS events'),
  ('saved_reports', 'Custom Reports', 'saved_reports', 'reporting', 'TOOLS', true, 'User-configurable saved queries over org data, rendered as table/bar/pie/line charts')
ON CONFLICT (module_key) DO NOTHING;
