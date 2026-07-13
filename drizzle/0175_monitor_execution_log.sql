-- GAP-UNIFIED-SOT-REMAINDER Wave-2 slice: closes the 2nd of the 2 gaps
-- PR #257's own header named for dispatch-completion-monitor.ts ("no
-- persisted digest" -- the 1st gap, "no cron wiring", is closed in the same
-- PR by the new /api/internal/dispatch-completion-monitor/run route and the
-- new vercel.json cron entry). See src/lib/db/schema.ts's monitorExecutionLog
-- export (just above this migration's target table) for the full reasoning
-- on why this is a new table rather than reusing loop_executions or
-- monitor_task_state.
--
-- NOT applied to the live database by this PR -- a human orchestrator (Super
-- Boss / Claude Desktop, per this repo's audit-then-apply posture) applies
-- it after review via the Supabase MCP, same posture as every other
-- migration in this session (0173/0174's own headers).
--
-- Additive-only: a single CREATE TABLE plus its indexes/RLS/grants, no
-- ALTER TABLE, no destructive statement anywhere in this file.
--
-- Platform-wide by design (no org_id column, same as compliance.monitor_agents
-- in drizzle/0173): one row per cron-triggered sweep run across ALL orgs,
-- not per-tenant data. Real RLS is still enabled per AGENTS.md Rule 9 (no
-- guardrail table ships without it) -- mirrors monitor_agents' own posture
-- exactly: app_runtime gets a broad SELECT policy (USING (true), since
-- there's no org_id column to filter on) plus INSERT so the cron route's
-- digest write works whichever DB role it runs as, and service_role gets
-- the unrestricted bypass every platform-operational table already has.
CREATE TABLE IF NOT EXISTS compliance.monitor_execution_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  monitor_name text NOT NULL,
  ran_at timestamp NOT NULL DEFAULT now(),
  checked integer NOT NULL,
  ok integer NOT NULL,
  escalated integer NOT NULL,
  invalid_reports integer NOT NULL,
  summary_text text
);

CREATE INDEX IF NOT EXISTS idx_monitor_execution_log_monitor_name ON compliance.monitor_execution_log(monitor_name);
CREATE INDEX IF NOT EXISTS idx_monitor_execution_log_ran_at ON compliance.monitor_execution_log(ran_at);

ALTER TABLE compliance.monitor_execution_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_monitor_execution_log ON compliance.monitor_execution_log FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_insert_monitor_execution_log ON compliance.monitor_execution_log FOR INSERT TO app_runtime WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_monitor_execution_log ON compliance.monitor_execution_log FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON compliance.monitor_execution_log TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.monitor_execution_log TO service_role;
