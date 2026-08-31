-- TET Engine (Task Execution Trace) increment 1 (2026-07-27). Hand-written,
-- not drizzle-kit `generate` output -- same reason as
-- 0267_construction_boq_hierarchy_interim_billing.sql (drizzle/meta/ is
-- missing per-migration snapshots between 0001 and 0264, only 0000's
-- baseline snapshot was ever committed, so `generate` would try to diff
-- against a near-empty baseline and recreate the entire schema). Modeled on
-- 0197_prompt_cache_metrics.sql's exact CREATE TABLE + RLS + GRANT shape for
-- this same org-scoped-observability-table family.
CREATE TABLE IF NOT EXISTS compliance.task_execution_traces (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  action_key text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  shield_verdict text,
  shield_block_reason text,
  steps jsonb NOT NULL DEFAULT '[]',
  input jsonb,
  output jsonb,
  error text,
  started_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_execution_traces_org_user_idx
  ON compliance.task_execution_traces (org_id, user_id);
CREATE INDEX IF NOT EXISTS task_execution_traces_org_action_idx
  ON compliance.task_execution_traces (org_id, action_key);

-- RLS -- mandatory in the same migration per ai-os/CONSTITUTION.yaml's
-- ARCH-03, same app_runtime_org_scoped + service_role_bypass template as
-- every other tenant-scoped table (see 0197_prompt_cache_metrics.sql).
ALTER TABLE compliance.task_execution_traces ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.task_execution_traces FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_task_execution_traces ON compliance.task_execution_traces FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.task_execution_traces TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.task_execution_traces TO service_role;
