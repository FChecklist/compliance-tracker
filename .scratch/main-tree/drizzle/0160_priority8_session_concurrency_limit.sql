-- Priority 8 (14-priority8-close-tree1-remaining-gaps.yaml, Super-Boss-direct
-- item, GAP-SESSION-LIMIT / U-D27.B1.S1): "max 2 concurrent sessions per
-- license (1 laptop + 1 mobile)". Built directly by the Super Boss, not a
-- subagent -- this touches requireAuth() (src/lib/supabase/auth-guard.ts),
-- the single central auth chokepoint every route in the app depends on, and
-- was previously judged too risky for a narrow-slice dispatch for exactly
-- that reason.
--
-- Deliberately safe design: this NEVER force-invalidates an existing live
-- session someone might be actively using. When enforcement is on and a
-- user already has 2+ recently-active sessions, a genuinely NEW 3rd session
-- is blocked with a clear message (auth-guard.ts) -- it does not silently
-- sign anyone out. Opt-in, same posture as licensedSeats/monthlyCostCapUsd:
-- every existing org's real behavior is completely unchanged until an admin
-- deliberately turns this on.

ALTER TABLE compliance.organisations
  ADD COLUMN IF NOT EXISTS session_limit_enforcement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions integer NOT NULL DEFAULT 2,
  -- Tree 1's own requirement: "exempted for VERIDIAN's own internal use/
  -- testing" -- a real, named exception carried in from day one, not
  -- retrofitted after the fact.
  ADD COLUMN IF NOT EXISTS internal_use_exempt boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS compliance.user_active_sessions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL,
  org_id text NOT NULL,
  -- SHA-256 hex digest of the Supabase Auth access token -- never the raw
  -- token itself. Unique per real session; used only to recognize "have we
  -- already seen this exact session" on a later request, never decoded back
  -- to the token.
  session_token_hash text NOT NULL,
  device_label text NOT NULL DEFAULT 'unknown', -- 'mobile' | 'desktop' | 'unknown', derived from User-Agent, best-effort only
  user_agent text,
  created_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_active_sessions_user_token_unique UNIQUE (user_id, session_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_active_sessions_user_last_seen ON compliance.user_active_sessions (user_id, last_seen_at DESC);

COMMENT ON TABLE compliance.user_active_sessions IS
  'Priority 8: tracks distinct Supabase Auth sessions per user for the opt-in concurrent-session limit (organisations.session_limit_enforcement_enabled). A row is upserted (lastSeenAt bumped) on each requireAuth() call from a session not yet seen this pass; rows older than 30 days are treated as stale/expired and not counted toward the limit, never explicitly deleted by app code (natural cleanup via a future retention job, not built this pass -- table stays small in practice since inserts only happen on genuinely new sessions).';

-- Same tenant-isolation + service-role-bypass RLS pattern as every other
-- new table (AGENTS.md Rule 9) -- requireAuth() itself runs through the raw
-- (RLS-bypassing) db client for the same reason org_join_codes/
-- org_invite_links do (this check happens BEFORE tenant context can be
-- established, since establishing it is what requireAuth() is doing), but
-- RLS is still enabled here as defense-in-depth for any future call site
-- that queries this table through the tenant-scoped client.
ALTER TABLE compliance.user_active_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.user_active_sessions FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_user_active_sessions ON compliance.user_active_sessions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.user_active_sessions TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.user_active_sessions TO service_role;
