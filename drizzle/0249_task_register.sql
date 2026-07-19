-- AIROUTER-01 Phase 2 (Owner directive 2026-07-19): Software Team L0-L5
-- execution ladder -- Instruction Contract / Execution Report task register.
--
-- Genuinely distinct from platform.ai_routing_audit_log (drizzle/0231):
-- that table logs ROUTING DECISIONS (which model got picked and why); this
-- table logs the actual TASK CONTRACT -- the pre-execution Instruction
-- Contract a Mother Router (L5) / Supervisor (L4) sends to a worker
-- (L1-L3), and the post-execution Execution Report the worker returns.
-- Schema is fixed jsonb (validated at the application layer by
-- src/lib/ai-router/instruction-contract.ts, same deterministic posture as
-- task-tightening.ts -- no DB-level JSON schema constraint), variables
-- change per task.

DO $$ BEGIN
  CREATE TYPE platform.task_register_status AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform.task_register (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL UNIQUE,
  level text NOT NULL,
  scope platform.ai_router_scope NOT NULL DEFAULT 'software_team',
  role_key text,
  status platform.task_register_status NOT NULL DEFAULT 'pending',
  instruction_contract jsonb NOT NULL,
  execution_report jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS task_register_level_idx ON platform.task_register (level);
CREATE INDEX IF NOT EXISTS task_register_status_idx ON platform.task_register (status);
CREATE INDEX IF NOT EXISTS task_register_created_at_idx ON platform.task_register (created_at);
