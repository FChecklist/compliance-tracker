-- Stage 12 (VERIDIAN_CONSOLIDATED_COMPLETION plan): closes the AI Dev Team
-- dispatch system's persistent-memory gap identified in
-- SYSTEM_MEMORY_ARCHITECTURE.yaml's own layer_5 entry -- zero record exists
-- today of what an AI Dev Team dispatch (runRole() in team-service.ts /
-- dispatchRepoTask() in dispatch-repo.ts) actually produced, or whether the
-- same work was already attempted. dispatch/route.ts's own
-- `if (orgId) recordActivity(...)` (activity_log is org_id NOT NULL) proves
-- this concretely: a veridian_admin dispatch with no orgId -- the normal
-- case for AI Dev Team work building VERIDIAN itself, not a customer org's
-- workflow (team-service.ts's own header) -- writes no activity_log row at
-- all. dispatch_outcomes is the org-agnostic backstop that always writes,
-- independent of whether the caller happens to have an orgId.
--
-- Platform schema + fail-closed RLS posture chosen to exactly mirror
-- platform.task_capabilities (drizzle/0156) and platform.ai_team_role_overrides
-- (drizzle/0234), the two existing precedents for "AI Dev Team /
-- platform-wide, no owning customer org" data: org_id nullable (null =
-- platform-internal dispatch, the common case; a real org_id only for the
-- rarer case a veridian_admin dispatch happens to run inside an org
-- context), RLS enabled with a service_role-only bypass policy and no
-- app_runtime/anon/authenticated policy -- this table is never queried via
-- PostgREST/the client-side Supabase client, only via the app's own
-- drizzle/postgres-js connection (src/lib/db/index.ts, which authenticates
-- as the `postgres` pooler role and so is unaffected by RLS either way) and
-- via service_role for any direct Studio/ops access. table-level GRANTs to
-- app_runtime are still added for consistency with every sibling table's
-- posture (wave134_force_rls_all_tables convention: grant broadly, gate
-- narrowly with RLS), even though no policy currently admits app_runtime
-- rows.
--
-- request_fingerprint is a sha256 hex digest of `${roleKey}::${normalized
-- objective}::${normalized scope}` (normalization: trim + collapse
-- whitespace + lowercase; see src/lib/ai-team/dispatch-outcomes.ts's
-- fingerprintDispatchRequest()) -- a fast, exact-match, case/whitespace-
-- insensitive "have we done this before" check, the same
-- category-then-keyword-match principle as
-- ai-os/scripts/superboss-register.py's check_duplicate(), applied here in
-- the product codebase against real dispatch history instead of the
-- server's own sqlite system_index.

CREATE TABLE IF NOT EXISTS platform.dispatch_outcomes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Which role/task was dispatched.
  role_key text NOT NULL,
  dispatch_path text NOT NULL DEFAULT 'advisory', -- 'advisory' (runRole(), team-service.ts) | 'repo_write' (dispatchRepoTask(), dispatch-repo.ts)

  -- What the real request was -- enough to detect a repeat.
  objective text NOT NULL,
  scope text,
  success_criteria text,
  complexity_tier text,
  request_fingerprint text NOT NULL, -- sha256(roleKey + normalized objective + normalized scope)

  -- The real outcome.
  status text NOT NULL, -- 'success' | 'failure' | 'blocked'
  pr_url text, -- set only for dispatch_path='repo_write' outcomes that produced a PR
  error_detail text, -- set only when status != 'success'
  model_used text, -- the actually-resolved model (roster-overrides.ts effective model), not just roster.ts's static default

  -- Who/when.
  org_id text, -- nullable = platform-internal AI Dev Team dispatch (the common case); real org_id only if this dispatch ran inside a customer org's context
  dispatched_by text, -- dbUser.id of the veridian_admin who dispatched, null for a system/automated caller
  dispatched_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),

  CONSTRAINT dispatch_outcomes_status_check CHECK (status IN ('success', 'failure', 'blocked')),
  CONSTRAINT dispatch_outcomes_dispatch_path_check CHECK (dispatch_path IN ('advisory', 'repo_write'))
);

-- Primary duplicate-detection lookup: exact-fingerprint match, most recent first.
CREATE INDEX IF NOT EXISTS idx_dispatch_outcomes_fingerprint ON platform.dispatch_outcomes(request_fingerprint, dispatched_at DESC);
-- Per-role dispatch history (scorecard/governance-health surfaces, role-level browsing).
CREATE INDEX IF NOT EXISTS idx_dispatch_outcomes_role ON platform.dispatch_outcomes(role_key, dispatched_at DESC);
-- Rare org-scoped lookups only; partial index since org_id is null for the overwhelming majority of rows.
CREATE INDEX IF NOT EXISTS idx_dispatch_outcomes_org ON platform.dispatch_outcomes(org_id, dispatched_at DESC) WHERE org_id IS NOT NULL;

ALTER TABLE platform.dispatch_outcomes ENABLE ROW LEVEL SECURITY;

-- Table-level grants for consistency with every sibling table (grant broadly,
-- gate narrowly with RLS -- wave134_force_rls_all_tables's own convention).
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.dispatch_outcomes TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.dispatch_outcomes TO service_role;

-- Fail-closed: no app_runtime/anon/authenticated policy is added, mirroring
-- platform.task_capabilities exactly -- this table is written/read only from
-- server-side code via the postgres pooler role (bypasses RLS) or via
-- service_role for ops/Studio access. Any future PostgREST/client-side
-- exposure would need to add its own explicit, reviewed policy here rather
-- than inheriting implicit access.
DO $$ BEGIN
  CREATE POLICY service_role_bypass_dispatch_outcomes ON platform.dispatch_outcomes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
