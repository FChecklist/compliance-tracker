-- Wave 160 (UNIVERSAL_TASK_WRAPPER_DESIGN.md, Phase 1 only): additive
-- envelope table so "every activity is a Task" becomes answerable without
-- touching or replacing the existing tasks/orchestraExecutions tables.
-- Zero backfill of historical rows -- see design doc for why (AI Dev Team
-- dispatches before this migration have no source data to backfill from
-- at all). parentActivityId deliberately deferred to a later phase (needs
-- a real dependency graph to be meaningful, not fabricated ahead of that).

CREATE TABLE IF NOT EXISTS compliance.activity_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text,
  user_id text,
  activity_type text NOT NULL, -- 'customer_task' | 'orchestra_call' | 'ai_team_dispatch' | 'loop_run'
  detail_table text,           -- 'tasks' | 'orchestra_executions' | null (ai_team_dispatch/loop_run have no detail row yet)
  detail_id text,
  lifecycle_stage text NOT NULL DEFAULT 'requested', -- requested | classified | validated | executing | reviewing | completed | failed | closed
  objective text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_org ON compliance.activity_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON compliance.activity_log(org_id, activity_type, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_activity_log_detail ON compliance.activity_log(detail_table, detail_id);

ALTER TABLE compliance.activity_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.activity_log FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_activity_log ON compliance.activity_log FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
