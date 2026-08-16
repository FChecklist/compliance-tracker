-- Priority 18b (Owner directive 2026-07-15, Option B): stage-0 self-serve
-- VERI Chat registration -- real multi-org stage-0 membership. See
-- ai-os/priority18b_stage0_design.md + its Option B addendum for the full
-- design writeup, and src/lib/services/stage0-service.ts for the real
-- provisioning/inbox/auto-upgrade logic. This migration is purely additive
-- (nullable/defaulted columns, IF NOT EXISTS everywhere) -- every existing
-- row and route is unaffected until a real stage-0 signup happens. The
-- 'stage_0' enum value itself was added in the immediately-preceding
-- migration (0209), which must run first and in its own transaction.

-- users.account_stage: nav-visibility axis only, NOT a security boundary
-- (see schema.ts's own comment on this column). Nullable, no default --
-- every pre-existing user is unaffected.
ALTER TABLE compliance.users ADD COLUMN IF NOT EXISTS account_stage text;

-- Growth-loop counters (design doc section 2.5) -- surfaced for free via
-- listShareLinks()/listGuestAccess() since Drizzle's findMany already
-- returns every column, no route change needed.
ALTER TABLE compliance.conversation_share_links ADD COLUMN IF NOT EXISTS stage0_signup_count integer NOT NULL DEFAULT 0;
ALTER TABLE compliance.conversation_guest_access ADD COLUMN IF NOT EXISTS stage0_signup_count integer NOT NULL DEFAULT 0;

-- stage0_sources: the real multi-org stage-0 membership table (Option B).
-- users.org_id/role stays the single "real home org" anchor; this table is
-- the separate, narrower, org_id-scoped read axis -- one row per
-- (user_id, org_id), RLS-scoped exactly like every other org-scoped table
-- in this codebase (app_runtime_tenant_isolation, AGENTS.md Rule 9).
CREATE TABLE IF NOT EXISTS compliance.stage0_sources (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL,
  org_id text NOT NULL,
  source_type text NOT NULL,
  source_token_id text NOT NULL,
  source_conversation_id text NOT NULL,
  joined_at timestamp NOT NULL DEFAULT now(),
  revoked_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_stage0_sources_org ON compliance.stage0_sources(org_id);
CREATE INDEX IF NOT EXISTS idx_stage0_sources_user ON compliance.stage0_sources(user_id);

-- Partial unique index (not a plain UNIQUE(user_id, org_id)): a revoked
-- relationship must not permanently block the same person re-joining the
-- same org's stage-0 pool later via a fresh token -- only ONE currently-
-- active (revoked_at IS NULL) relationship per (user_id, org_id) is
-- enforced.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage0_sources_active_user_org
  ON compliance.stage0_sources(user_id, org_id)
  WHERE revoked_at IS NULL;

ALTER TABLE compliance.stage0_sources ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.stage0_sources FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_stage0_sources ON compliance.stage0_sources FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
