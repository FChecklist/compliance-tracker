-- ai-os gap mother-router-roster-memory (2026-07-26): ground-up persistent
-- memory for the Mother Router (src/lib/ai-router/mother-router.ts) and the
-- AI agent roster (src/lib/ai-team/roster.ts, written from its one real
-- dispatch call site, /api/ai/team/dispatch).
--
-- Genuinely distinct from platform.ai_routing_audit_log (drizzle/0231): that
-- table is a write-once RESOLUTION log. mother_router_memory rows start at
-- resolution time and are UPDATED once the dispatch's real outcome/cost are
-- known -- see mother-router.ts's recordMotherRouterMemory()/
-- updateMotherRouterMemoryOutcome().
--
-- Genuinely distinct from platform.task_register (drizzle/0249): that table
-- carries full Instruction Contract/Execution Report jsonb content for
-- AIROUTER-01 Phase 2 softwareTeamLevel dispatches only. ai_agent_memory is
-- a lightweight per-agent-dispatch row for EVERY roster dispatch.

DO $$ BEGIN
  CREATE TYPE platform.mother_router_memory_outcome AS ENUM ('pending', 'success', 'failure', 'escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Deliberately the same 4 values as platform.task_register_status
-- (drizzle/0249) -- see schema.ts's aiAgentMemoryOutcomeEnum comment.
DO $$ BEGIN
  CREATE TYPE platform.ai_agent_memory_outcome AS ENUM ('in_progress', 'completed', 'failed', 'escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform.mother_router_memory (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dispatch_id text NOT NULL UNIQUE,
  ts timestamp NOT NULL DEFAULT now(),
  input_capability_tag text,
  resolved_role text,
  resolved_model text NOT NULL,
  outcome platform.mother_router_memory_outcome NOT NULL DEFAULT 'pending',
  cost numeric(12, 6),
  cross_ref_work_item_id text
);

CREATE INDEX IF NOT EXISTS mother_router_memory_ts_idx ON platform.mother_router_memory (ts);
CREATE INDEX IF NOT EXISTS mother_router_memory_resolved_role_idx ON platform.mother_router_memory (resolved_role);
CREATE INDEX IF NOT EXISTS mother_router_memory_cross_ref_work_item_id_idx ON platform.mother_router_memory (cross_ref_work_item_id);

-- RLS: same app_runtime/service_role split as the sibling platform.ai_routing_audit_log
-- (verified live via pg_policies before writing this) -- app_runtime also
-- gets UPDATE here (unlike that append-only table) since this row is
-- written at resolution time and updated once outcome/cost are known.
ALTER TABLE platform.mother_router_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_insert_mother_router_memory ON platform.mother_router_memory FOR INSERT TO app_runtime WITH CHECK (true);
CREATE POLICY app_runtime_update_mother_router_memory ON platform.mother_router_memory FOR UPDATE TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_read_mother_router_memory ON platform.mother_router_memory FOR SELECT TO app_runtime USING (true);
CREATE POLICY service_role_bypass_mother_router_memory ON platform.mother_router_memory FOR ALL TO service_role USING (true);

CREATE TABLE IF NOT EXISTS platform.ai_agent_memory (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_id text NOT NULL,
  ts timestamp NOT NULL DEFAULT now(),
  task_id text,
  outcome platform.ai_agent_memory_outcome NOT NULL,
  escalation_flag boolean NOT NULL DEFAULT false,
  cross_ref_work_item_id text
);

CREATE INDEX IF NOT EXISTS ai_agent_memory_role_id_idx ON platform.ai_agent_memory (role_id);
CREATE INDEX IF NOT EXISTS ai_agent_memory_ts_idx ON platform.ai_agent_memory (ts);
CREATE INDEX IF NOT EXISTS ai_agent_memory_task_id_idx ON platform.ai_agent_memory (task_id);

-- RLS: append-only from the app's perspective (one write per dispatch, no
-- update path), same app_runtime/service_role split as
-- platform.ai_routing_audit_log.
ALTER TABLE platform.ai_agent_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_insert_ai_agent_memory ON platform.ai_agent_memory FOR INSERT TO app_runtime WITH CHECK (true);
CREATE POLICY app_runtime_read_ai_agent_memory ON platform.ai_agent_memory FOR SELECT TO app_runtime USING (true);
CREATE POLICY service_role_bypass_ai_agent_memory ON platform.ai_agent_memory FOR ALL TO service_role USING (true);
