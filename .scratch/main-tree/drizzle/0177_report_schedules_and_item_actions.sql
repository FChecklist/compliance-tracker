-- Owner directive 2026-07-13: reports should be schedulable (daily/weekly/
-- monthly, user/org-definable) and report result rows should have a real
-- action flow (accept/send-to-todo/delegate). Two new, additive tables --
-- report_schedules and report_item_actions -- following saved_reports'
-- (0023_wave29_31_kb_automation_reports.sql) and metric_alert_rules'
-- (0028_wave38_metric_alert_rules.sql) exact RLS/grant conventions.
--
-- report_schedules.report_id is deliberately NOT a foreign key into
-- saved_reports or any report-catalog table -- kept decoupled since a
-- separate agent may or may not have merged a catalog table independently
-- of this migration.
--
-- report_item_actions invents no new business-status transition on
-- compliance_items/notices/risks/pms_issues/incidents -- it only records an
-- action taken on a report row itself (target_id points at the real
-- scoped_delegations or tasks row a delegate/todo action created).

CREATE TABLE IF NOT EXISTS compliance.report_schedules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  report_id text NOT NULL,
  cadence text NOT NULL,
  day_of_week integer,
  day_of_month integer,
  recipient_user_ids jsonb NOT NULL DEFAULT '[]',
  created_by text NOT NULL REFERENCES compliance.users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.report_schedules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.report_schedules FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_report_schedules ON compliance.report_schedules FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_schedules TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_schedules TO service_role;

CREATE INDEX IF NOT EXISTS idx_report_schedules_org_id ON compliance.report_schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_is_active ON compliance.report_schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_report_schedules_report_id ON compliance.report_schedules(report_id);

CREATE TABLE IF NOT EXISTS compliance.report_item_actions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  report_id text NOT NULL,
  row_id text NOT NULL,
  user_id text NOT NULL REFERENCES compliance.users(id),
  action text NOT NULL,
  target_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.report_item_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.report_item_actions FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_report_item_actions ON compliance.report_item_actions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_item_actions TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_item_actions TO service_role;

CREATE INDEX IF NOT EXISTS idx_report_item_actions_org_id ON compliance.report_item_actions(org_id);
CREATE INDEX IF NOT EXISTS idx_report_item_actions_report_id ON compliance.report_item_actions(report_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('report_schedules', 'Report Schedules', 'report_schedules', 'reporting', 'TOOLS', false, 'User/org-definable daily/weekly/monthly schedules for reports, evaluated via Vercel Cron and delivered through the existing notifications mechanism'),
  ('report_item_actions', 'Report Item Actions', 'report_item_actions', 'reporting', 'TOOLS', false, 'Accept/send-to-todo/delegate action trail recorded against individual report-result rows, without inventing new status transitions on the underlying domain entities')
ON CONFLICT (module_key) DO NOTHING;
