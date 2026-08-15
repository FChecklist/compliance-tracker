-- Ops-layer task-tracking bridge (2026-07-20, PR #502) -- mirrors
-- VERIDIAN-DEV (Hetzner ops server) autonomous coding-task state
-- (CONTROLLER.yaml / superboss-register.sqlite) into this DB so it is
-- queryable from the app side. Not org-scoped by design, same convention as
-- platform.worker_agent_domain_index -- this is internal engineering work,
-- not customer data. Written only via POST /api/internal/ops-task-sync
-- (OPS_SYNC_SECRET bearer auth), called from veridian-task.py on the ops
-- server at its existing checkpoint choke point -- app code should treat
-- this table as read-only.
--
-- Added by this session while auditing PR #502 (ops-task-sync bridge):
-- the PR own diff added src/lib/db/schema.ts platform.opsDevTasks
-- table definition but never added the matching drizzle migration file --
-- a real gap (a schema.ts change with no migration means the live database
-- never gets this table, and the PR own new route would fail at runtime
-- on first insert). This migration is written to match that schema.ts
-- table definition exactly (see schema.ts own opsDevTasks export).
--
-- NOT applied to the live database by this PR -- a human orchestrator
-- applies it after review, same posture as every other migration in this
-- session.

CREATE TABLE IF NOT EXISTS platform.ops_dev_tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ops_task_id text NOT NULL UNIQUE,
  title text NOT NULL,
  repo text NOT NULL,
  branch text,
  status text NOT NULL,
  pr_url text,
  software_task_id text,
  ai_task_id text,
  execution_seconds integer,
  restart_count integer,
  last_checkpoint_note text,
  created_at timestamp NOT NULL DEFAULT now(),
  last_synced_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_dev_tasks_status_idx ON platform.ops_dev_tasks (status);
CREATE INDEX IF NOT EXISTS ops_dev_tasks_repo_idx ON platform.ops_dev_tasks (repo);
