-- Area 15/18 (U-D27.B1.S1): Secure Invite Link, the second invitation path
-- alongside Master-Admin-direct-add (POST /api/users). See
-- src/lib/invite-link-service.ts for the full design/security-property
-- writeup. RLS follows the same tenant-isolation + service-role-bypass
-- pattern as every other new table this session (e.g.
-- 0140_wave166_monitoring_tool_health.sql) -- AGENTS.md Rule 9: every new
-- table gets real RLS, not just an org_id column. In practice the two real
-- read/write paths for this table (public link preview, invite consumption
-- at first login) run through the raw (RLS-bypassing) db client, same
-- posture as api_keys/autoProvisionUser -- this RLS is defense-in-depth for
-- any future tenant-scoped query against this table, not the primary gate.

CREATE TABLE IF NOT EXISTS compliance.org_invite_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  label text,
  created_by_user_id text NOT NULL,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  revoked_by_user_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_invite_links_org ON compliance.org_invite_links(org_id);

ALTER TABLE compliance.org_invite_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.org_invite_links FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_org_invite_links ON compliance.org_invite_links FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
