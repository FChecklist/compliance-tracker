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
--
-- E-103 fix (2026-08-28): the ALTER TABLE line below targets
-- compliance.dynamic_chains, matching what this migration actually applied
-- historically (dynamic_chains does not move to the platform schema until
-- 0245_create_platform_schema_compartment.sql, which runs ~100 journal
-- entries later and carries this column across via ALTER TABLE ... SET
-- SCHEMA). Commit 9288746 (26 Jul 2026, "Fix PR #563 CI: ... correct stale
-- migration schema refs") had rewritten this line to platform.dynamic_chains
-- to match the then-current live schema -- silently breaking a from-scratch
-- replay (platform.dynamic_chains doesn't exist yet at this point in the
-- journal) and desynchronising this file from the hash already recorded in
-- drizzle.__drizzle_migrations for this entry, in violation of this repo's
-- own "never edit an already-applied migration" rule (see platform.error_log
-- E-103's prevention_rule). Reverted here to the historically-correct,
-- hash-matching form. No live database action needed -- production already
-- has this column on platform.dynamic_chains from when 0245 ran there.

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
