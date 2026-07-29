-- VERIDIAN_CONSOLIDATED_COMPLETION Stage 12: closes the AI Dev Team
-- dispatch system's confirmed persistent-memory gap (SYSTEM_MEMORY_
-- ARCHITECTURE.yaml's own honest layer_5 entry). Before this table,
-- nothing recorded what the AI Dev Team had already been dispatched to
-- do, so there was no way to check "have we dispatched something like
-- this before" prior to a new dispatch. Written by team-service.ts's
-- runRole() (status='completed') and dispatch-repo.ts's
-- dispatchRepoTask() (status='dispatched' -- that path only fires a
-- GitHub repository_dispatch event and returns, it does not await the
-- real PR outcome). See src/lib/ai-team/dispatch-memory-service.ts for
-- the record/check functions and src/lib/db/schema.ts's dispatchOutcomes
-- comment for the full design rationale.
--
-- Platform-level table (no org_id -- the AI Dev Team builds VERIDIAN
-- itself, it never runs inside a customer org's tenant context, per
-- team-service.ts's own file-header comment), same RLS posture as
-- platform.ai_team_role_overrides (drizzle/0234): app_runtime has
-- unconditional read/write (there is no tenant dimension to filter by),
-- service_role has full bypass. Deliberately NOT the worker_agent_usage_log
-- posture (org_id/client_id/user_id-conditional RLS) -- every real row
-- here has all three null, so that policy shape would silently deny
-- app_runtime all access to its own writes.
--
-- pg_trgm already installed (drizzle/0079, Wave 93 MDM duplicate
-- detection) -- reused here for near-duplicate objective matching via
-- similarity(), not re-installed.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS platform.dispatch_outcomes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_key text NOT NULL,
  objective_summary text NOT NULL,
  objective_hash text NOT NULL,
  dispatch_surface text NOT NULL,
  status text NOT NULL,
  model text,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Exact-match dedup lookup: same role_key + objectiveHash.
CREATE INDEX IF NOT EXISTS dispatch_outcomes_role_hash_idx
  ON platform.dispatch_outcomes (role_key, objective_hash);

-- Near-duplicate lookup: pg_trgm similarity() scan on objective_summary,
-- same index shape as idx_fm_assets_normalized_name_trgm (drizzle/0085)
-- and idx_erp_customers_name_trgm (drizzle/0079).
CREATE INDEX IF NOT EXISTS dispatch_outcomes_objective_trgm_idx
  ON platform.dispatch_outcomes USING gin (objective_summary gin_trgm_ops);

ALTER TABLE platform.dispatch_outcomes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_dispatch_outcomes ON platform.dispatch_outcomes
    FOR ALL TO app_runtime USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_dispatch_outcomes ON platform.dispatch_outcomes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Explicit grants (belt-and-braces alongside 0245's ALTER DEFAULT
-- PRIVILEGES IN SCHEMA platform, same defensive convention as 0234's
-- grants on compliance.ai_team_role_overrides). No anon/authenticated
-- grant -- unlike ai_team_role_overrides (which a no-DB-access script
-- needs to read as anon), nothing outside app_runtime/service_role has a
-- real reason to read this table.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.dispatch_outcomes TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.dispatch_outcomes TO service_role;
