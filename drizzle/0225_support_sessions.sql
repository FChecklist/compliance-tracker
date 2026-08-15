-- VERIDIAN Review Framework Wave 4, Track 1b item 2 (2026-07-18): real,
-- audited "act on behalf of customer" support-session capability. Confirmed
-- via a fresh grep of src/ immediately before this migration was written --
-- zero "act on behalf"/"impersonat"/"support session" concept existed
-- anywhere in this codebase. A prior session validated this exact plan
-- (registered as a claim, then never implemented); this migration follows
-- it precisely.
--
-- This table is inherently cross-org: a veridian_admin (support staff)
-- starting a session against a customer org is never scoped to their OWN
-- org, so its writes come from the raw/service-role db client (see
-- support-session-service.ts), not app_runtime under withTenantContext --
-- same posture as org-provisioning-service.ts's platform-level inserts.
-- Reads for the IMPERSONATED org's own admin (GET
-- /api/support-sessions/on-my-org) go through the normal app_runtime RLS
-- path, scoped by target_org_id = compliance.current_org_id() -- the same
-- 2-policy app_runtime/service_role_bypass + FORCE ROW LEVEL SECURITY shape
-- every other tenant table in this schema uses (see drizzle/0219's
-- crm_accounts/crm_contacts for the precedent this mirrors).
CREATE TABLE IF NOT EXISTS compliance.support_sessions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  initiated_by_user_id text NOT NULL REFERENCES compliance.users(id),
  -- Denormalized snapshot at start time, not a live join -- same rationale
  -- as audit_logs.actor_name: the target org must keep seeing who accessed
  -- them even if that support user is later renamed/deactivated.
  initiated_by_name text NOT NULL,
  target_org_id text NOT NULL REFERENCES compliance.organisations(id),
  target_user_id text NOT NULL REFERENCES compliance.users(id),
  target_user_name text NOT NULL,
  reason text NOT NULL,
  -- sha256 hex digest, never the raw token -- same hashSHA256()/
  -- never-persist-the-raw-token convention as api_keys.key_hash and
  -- org_invite_links.token_hash.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL, -- fixed 1-hour lifetime, set by the service layer at insert time
  ended_at timestamp,
  ended_reason text,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.support_sessions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.support_sessions FOR ALL TO app_runtime
    USING (target_org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_support_sessions ON compliance.support_sessions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.support_sessions TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.support_sessions TO service_role;

CREATE INDEX IF NOT EXISTS idx_support_sessions_target_org_id ON compliance.support_sessions(target_org_id);
CREATE INDEX IF NOT EXISTS idx_support_sessions_initiated_by_user_id ON compliance.support_sessions(initiated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_support_sessions_expires_at ON compliance.support_sessions(expires_at);

-- Two additive nullable columns on the EXISTING audit_logs table -- this is
-- deliberately NOT a second logging table. audit_logs/logActivity() (see
-- src/lib/audit.ts) is the real, single generic per-write audit mechanism,
-- already consumed by src/app/(app)/audit/page.tsx + GET /api/audit/route.ts.
-- Every pre-existing row and every pre-existing logActivity() call site is
-- completely unaffected: null = "not performed under a support session,"
-- the overwhelming majority of rows.
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS support_session_id text;
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS acting_on_behalf_of_user_id text;
CREATE INDEX IF NOT EXISTS idx_audit_logs_support_session_id ON compliance.audit_logs(support_session_id) WHERE support_session_id IS NOT NULL;
