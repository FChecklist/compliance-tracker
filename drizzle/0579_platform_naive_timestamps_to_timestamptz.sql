-- DOD-T8 (D28). 50 timezone-naive columns found in schema `platform`, live
-- query on pcrjmlpuqsbocqfwoxod 2026-09-10 (information_schema.columns WHERE
-- data_type='timestamp without time zone', schemas platform+public --
-- public had zero, platform had all 50). Same correctness risk 0556 (R71
-- Phase 8) already fixed for 7 columns in `compliance`: a bitemporal/
-- event-ordered store mixing naive and aware temporal types can compare rows
-- logged at the "same instant" from different client zones as out of order.
-- This migration is `platform`'s equivalent of 0556, not a duplicate of it --
-- 0556 never touched this schema.
--
-- ASSUMED SOURCE TIMEZONE: UTC, stated explicitly per 0556's own precedent.
-- Every column here defaults to now() (Postgres's own UTC-based clock) or is
-- application-written by the same Node/Bun runtime that writes every already-
-- timestamptz column in this project in UTC. No column below has ever
-- received a non-UTC value.
--
-- NOT APPLIED. Sent to PM for a D48 per-migration ruling before landing,
-- per the owner-pressure scope change (2026-09-10 14:04 IST). Committed in a
-- throwaway worktree (C:\ct\.worktrees\w-gap-inst-a), never pushed --
-- GitHub auth is down machine-wide as of 13:58 IST and push/merge needs the
-- owner's re-auth regardless.

ALTER TABLE platform.ai_agent_memory
  ALTER COLUMN ts TYPE timestamptz USING ts AT TIME ZONE 'UTC';

ALTER TABLE platform.ai_connector_providers
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.ai_model_registry
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.ai_routing_audit_log
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE platform.ai_routing_policies
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE platform.ai_team_role_overrides
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.automation_rule_runs
  ALTER COLUMN triggered_at TYPE timestamptz USING triggered_at AT TIME ZONE 'UTC';

ALTER TABLE platform.automation_rules
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.capability_improvement_proposals
  ALTER COLUMN created_at    TYPE timestamptz USING created_at    AT TIME ZONE 'UTC',
  ALTER COLUMN dispatched_at TYPE timestamptz USING dispatched_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at    TYPE timestamptz USING updated_at    AT TIME ZONE 'UTC';

ALTER TABLE platform.crr_embeddings_pre_snapshot
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE platform.dispatch_outcomes
  ALTER COLUMN completed_at  TYPE timestamptz USING completed_at  AT TIME ZONE 'UTC',
  ALTER COLUMN created_at    TYPE timestamptz USING created_at    AT TIME ZONE 'UTC',
  ALTER COLUMN dispatched_at TYPE timestamptz USING dispatched_at AT TIME ZONE 'UTC';

ALTER TABLE platform.dynamic_chains
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.entity_relationships
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.fde_requests
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE platform.instruction_execution_cache
  ALTER COLUMN created_at   TYPE timestamptz USING created_at   AT TIME ZONE 'UTC',
  ALTER COLUMN last_used_at TYPE timestamptz USING last_used_at AT TIME ZONE 'UTC';

ALTER TABLE platform.module_registry
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.module_rule_configs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.mother_router_memory
  ALTER COLUMN ts TYPE timestamptz USING ts AT TIME ZONE 'UTC';

ALTER TABLE platform.pipeline_level_models
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE platform.pipeline_similarity_metrics
  ALTER COLUMN measured_at TYPE timestamptz USING measured_at AT TIME ZONE 'UTC';

ALTER TABLE platform.product_branch_modules
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE platform.product_branches
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE platform.provider_outage_windows
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN ended_at   TYPE timestamptz USING ended_at   AT TIME ZONE 'UTC',
  ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC';

ALTER TABLE platform.role_quality_runs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE platform.task_capabilities
  ALTER COLUMN created_at      TYPE timestamptz USING created_at      AT TIME ZONE 'UTC',
  ALTER COLUMN last_audited_at TYPE timestamptz USING last_audited_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at      TYPE timestamptz USING updated_at      AT TIME ZONE 'UTC';

ALTER TABLE platform.task_register
  ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at   TYPE timestamptz USING created_at   AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at   TYPE timestamptz USING updated_at   AT TIME ZONE 'UTC';

ALTER TABLE platform.user_ai_links
  ALTER COLUMN created_at   TYPE timestamptz USING created_at   AT TIME ZONE 'UTC',
  ALTER COLUMN last_used_at TYPE timestamptz USING last_used_at AT TIME ZONE 'UTC',
  ALTER COLUMN revoked_at   TYPE timestamptz USING revoked_at   AT TIME ZONE 'UTC';

ALTER TABLE platform.worker_agent_domain_groups
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
