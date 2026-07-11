-- Wave 166 (tree4-unified/10-merged-governance-layer.yaml U-D14 "Monitoring
-- (multi-scope)"): additive-only.
--
-- 1. New tool_health_events table (U-D14.B1.S1 "Tool Health" gap) -- a
--    single orchestra_executions row can invoke several tools, so this is a
--    new table rather than a column on that existing table. execution_id is
--    a soft reference by convention (like activity_log.detail_id), not a
--    DB-level FK. RLS follows the same tenant-isolation + service-role-
--    bypass pattern as 0135_wave161_dynamic_chains.sql (AGENTS.md Rule 9 --
--    every new table gets real RLS, not just an org_id column).
-- 2. New nullable dynamic_chains.monitoring_rules column (U-D14.B2.S1
--    "predefined monitoring rules per Dynamic Chain" gap, first pass only --
--    see schema.ts's comment on this column for why enforcement is
--    deliberately out of scope here). No RLS change needed -- the table
--    already has it from 0135.

CREATE TABLE IF NOT EXISTS compliance.tool_health_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  execution_id text,
  tool_name text NOT NULL,
  succeeded boolean NOT NULL,
  error_message text,
  duration_ms integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_health_events_org_tool ON compliance.tool_health_events(org_id, tool_name, created_at);

ALTER TABLE compliance.tool_health_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.tool_health_events FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_tool_health_events ON compliance.tool_health_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS monitoring_rules jsonb;
