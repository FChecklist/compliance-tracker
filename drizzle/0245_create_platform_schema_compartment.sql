-- Owner directive 2026-07-19: Supabase free tier limits us to 2 projects/
-- databases total (confirmed: FChecklist/projexa + FChecklist/verdian-ai
-- are the only 2 that exist). "The UI/UX database will be under
-- compliance-tracker, but in a separate compartment" -- a new Postgres
-- schema WITHIN this same database, not a second database, designed so a
-- future split into its own physical Supabase project is a clean
-- schema-level export (pg_dump --schema=platform) rather than an
-- untangling of a monolithic schema.
--
-- Hand-authored SQL, applied out-of-band via the Supabase MCP by a
-- DB-access-capable session -- same convention as every other migration in
-- this directory since 0005 (see drizzle/0236's own header for the
-- precedent). Captured here for history/review; NOT replayed by
-- drizzle-kit migrate.
--
-- Honest limitation, stated once here rather than per-table: Postgres
-- foreign keys cannot cross databases. These tables' FKs to
-- compliance.organisations/compliance.users remain real DB constraints
-- while co-located in one database. A genuine future split to a separate
-- physical database would require those FKs replaced with
-- application-level integrity checks -- this migration makes that split
-- EASIER (schema-level boundary already drawn) but does not itself
-- achieve full database independence.
--
-- Scope decision: platform_assets and platform_applications are
-- deliberately EXCLUDED and remain in compliance -- compliance.
-- auto_register_asset() (the UMR registration trigger function) hardcodes
-- writes to compliance.platform_assets; moving it would break every
-- registration trigger on the tables moved below. Verified via
-- pg_get_functiondef(...) before this migration, not assumed. The trigger
-- function itself is schema-agnostic about its SOURCE table (matches by
-- bare TG_TABLE_NAME), so moving the 22 tables below is safe.

CREATE SCHEMA IF NOT EXISTS platform;

GRANT USAGE ON SCHEMA platform TO app_runtime, service_role, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

-- Dynamic Chain / capability graph (DMP-04/DMP-06)
ALTER TABLE compliance.dynamic_chains SET SCHEMA platform;
ALTER TABLE compliance.entity_relationships SET SCHEMA platform;

-- Worker Agent catalog (the dispatchable capability roster)
ALTER TABLE compliance.worker_agents SET SCHEMA platform;
ALTER TABLE compliance.worker_agent_domain_groups SET SCHEMA platform;
ALTER TABLE compliance.worker_agent_domain_index SET SCHEMA platform;
ALTER TABLE compliance.worker_agent_learnings SET SCHEMA platform;
ALTER TABLE compliance.worker_agent_usage_log SET SCHEMA platform;
ALTER TABLE compliance.worker_agent_versions SET SCHEMA platform;

-- Module/nav registry (capability-tree structure)
ALTER TABLE compliance.module_registry SET SCHEMA platform;
ALTER TABLE compliance.product_branches SET SCHEMA platform;
ALTER TABLE compliance.product_branch_modules SET SCHEMA platform;
ALTER TABLE compliance.module_rule_configs SET SCHEMA platform;

-- UMR-03 instruction->execution-path cache
ALTER TABLE compliance.instruction_execution_cache SET SCHEMA platform;

-- Capability learning / X-Y-A-B classification
ALTER TABLE compliance.capability_improvement_proposals SET SCHEMA platform;
ALTER TABLE compliance.task_capabilities SET SCHEMA platform;

-- FDE ("my option is not available") + chain execution
ALTER TABLE compliance.fde_requests SET SCHEMA platform;
ALTER TABLE compliance.automation_rules SET SCHEMA platform;
ALTER TABLE compliance.automation_rule_runs SET SCHEMA platform;

-- AI Router ("Mother Router", AIROUTER-01)
ALTER TABLE compliance.ai_model_registry SET SCHEMA platform;
ALTER TABLE compliance.ai_routing_policies SET SCHEMA platform;
ALTER TABLE compliance.ai_routing_audit_log SET SCHEMA platform;
ALTER TABLE compliance.ai_team_role_overrides SET SCHEMA platform;

-- Enum types owned by the moved tables above (ALTER TABLE SET SCHEMA does
-- not move a column's enum TYPE, only the table itself).
ALTER TYPE compliance.ai_router_scope SET SCHEMA platform;
ALTER TYPE compliance.ai_model_status SET SCHEMA platform;
ALTER TYPE compliance.ai_model_health SET SCHEMA platform;
