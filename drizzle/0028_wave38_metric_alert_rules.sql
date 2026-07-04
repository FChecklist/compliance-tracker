-- Wave 38: Metric Alert Rules (Grafana-inspired scheduled threshold
-- alerting, PLATFORM_STRATEGY.md §22). Grafana itself was evaluated and
-- rejected as software (AGPL-3.0 core, standalone Go server + own DB, no
-- Vercel-serverless path) -- only its alert-rule-evaluated-periodically
-- pattern is adapted natively here, reusing the exact sourceEntity/
-- filterField whitelist custom-report-service.ts already validates
-- against (never a new arbitrary-query surface) and the existing daily
-- Vercel Cron mechanism already proven in production (loops/run,
-- instruction-audit/run). Also the mechanism Ticketing (Wave 39, §21)
-- reuses for SLA-deadline breach detection.

CREATE TABLE IF NOT EXISTS compliance.metric_alert_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  source_entity text NOT NULL,
  filter_field text,
  filter_value text,
  operator text NOT NULL DEFAULT 'gt',
  threshold integer NOT NULL,
  notify_user_ids jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamp,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.metric_alert_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.metric_alert_rules FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_metric_alert_rules ON compliance.metric_alert_rules FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.metric_alert_rules TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.metric_alert_rules TO service_role;

CREATE INDEX IF NOT EXISTS idx_metric_alert_rules_org_id ON compliance.metric_alert_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_metric_alert_rules_is_active ON compliance.metric_alert_rules(is_active);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('metric_alert_rules', 'Metric Alerts', 'metric_alert_rules', 'reporting', 'TOOLS', true, 'Scheduled threshold alerts over org metrics, evaluated daily via Vercel Cron and notifying via the existing notification mechanism')
ON CONFLICT (module_key) DO NOTHING;
