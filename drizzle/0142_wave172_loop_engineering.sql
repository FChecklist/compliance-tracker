-- Wave 172 (tree4-unified/50-completion-plan area 12 "Loop Engineering").
-- DEC-03 (area 5) rejected retrofitting tasks.status into a ~30-state
-- Universal Work Object -- everything here is additive against the EXISTING
-- task-completion touchpoints (task-execution-engine.ts, activity-log-
-- service.ts), not a schema redesign of tasks/activity_log's own status
-- columns.
--
-- NOT applied to the live database by this PR -- see the accompanying PR
-- description. A human orchestrator applies it after review, same posture
-- as 0139_wave167_handover_protocol.sql.

-- (1) activity_log: attribute an ai_team_dispatch row to the role that ran
-- it, how long it took, and why it failed -- real data the per-AI-Agent
-- directory (ai_agent_directory below) aggregates from, not invented.
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS role_key text;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS error_reason text;

CREATE INDEX IF NOT EXISTS idx_activity_log_role_key ON compliance.activity_log(role_key) WHERE role_key IS NOT NULL;

-- (2) task_reflections: universal reflective-question record for every task/
-- dispatch that reaches a real terminal state. Polymorphic source_type/
-- source_id, same convention as activity_log.detail_table/detail_id.
CREATE TABLE IF NOT EXISTS compliance.task_reflections (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  source_type text NOT NULL, -- 'task' | 'ai_team_dispatch'
  source_id text NOT NULL,
  role_key text,
  outcome text NOT NULL, -- 'success' | 'failure'
  summary text,
  failure_reason text,
  elapsed_ms integer,
  comparison_avg_elapsed_ms numeric,
  speed_verdict text, -- 'faster_than_recent_avg' | 'slower_than_recent_avg' | 'in_line' | 'insufficient_data'
  cost_usd numeric,
  comparison_avg_cost_usd numeric,
  cost_verdict text, -- same shape as speed_verdict, plus 'not_applicable'
  different_ai_tier_flag jsonb, -- { currentIdentifier, needsJudgment: true, verdict: null, note } -- never auto-decided
  reusable_pattern_flag jsonb, -- same shape -- never auto-decided
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_reflections_org ON compliance.task_reflections(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_reflections_source ON compliance.task_reflections(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_task_reflections_role_key ON compliance.task_reflections(role_key) WHERE role_key IS NOT NULL;

ALTER TABLE compliance.task_reflections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.task_reflections FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_task_reflections ON compliance.task_reflections FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (3) ai_agent_directory: one row per AI Dev Team role_key (roster.ts),
-- upserted by agent-directory-service.ts after each dispatch closes.
-- Platform-level (spans every org's dispatches under one role), not tenant
-- data -- same service_role-bypass-only posture as token_usage_ledger.
CREATE TABLE IF NOT EXISTS compliance.ai_agent_directory (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_key text NOT NULL UNIQUE,
  title text,
  team text,
  latest_task_summary text,
  latest_prompt_version integer,
  total_dispatches integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  avg_duration_ms numeric,
  common_errors jsonb NOT NULL DEFAULT '[]',
  improvement_suggestions text,
  validation_rules jsonb,
  loop_engineering_status text NOT NULL DEFAULT 'not_yet_assessed',
  last_computed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_directory_role_key ON compliance.ai_agent_directory(role_key);

ALTER TABLE compliance.ai_agent_directory ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_ai_agent_directory ON compliance.ai_agent_directory FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.ai_agent_directory TO service_role;
