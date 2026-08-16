-- Area 15 (U-D27.B3.S1, "4 distinct invitation paths"): Path C from
-- Requirement.docx -- "User Self-Registration via code -- user goes into
-- Settings [here: the signup form itself], enters a code given by the
-- Master Admin, account gets activated." Third of the 4 paths to exist
-- (Master-Admin-direct-add and Secure Invite Link already shipped). See
-- src/lib/org-join-code-service.ts for the full security-property writeup.
-- RLS follows the same tenant-isolation + service-role-bypass pattern as
-- every other new table (AGENTS.md Rule 9) -- in practice the real
-- pre-auth read/write paths (public preview, redemption at first login)
-- run through the raw (RLS-bypassing) db client, same posture
-- org_invite_links already documents for the identical reason.

CREATE TABLE IF NOT EXISTS compliance.org_join_codes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  role text NOT NULL,
  code_hash text NOT NULL UNIQUE,
  code_prefix text NOT NULL,
  label text,
  created_by_user_id text NOT NULL,
  expires_at timestamp,
  redeem_count integer NOT NULL DEFAULT 0,
  revoked_at timestamp,
  revoked_by_user_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_join_codes_org ON compliance.org_join_codes(org_id);

ALTER TABLE compliance.org_join_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.org_join_codes FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_org_join_codes ON compliance.org_join_codes FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.org_join_codes TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.org_join_codes TO service_role;

-- Rate-limit log for redemption/preview attempts (brute-force resistance
-- for a necessarily-short human-typed secret, per dispatch brief). Keyed
-- by requester IP, not org/code -- an attempt against an unresolved code
-- has no org to attribute to yet. org_id is nullable and only populated
-- when the attempt matched a real row.
CREATE TABLE IF NOT EXISTS compliance.org_join_code_attempts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ip_address text NOT NULL,
  org_id text,
  was_successful boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Backs the trailing-window rate-limit count query, keyed by IP.
CREATE INDEX IF NOT EXISTS idx_org_join_code_attempts_ip_created ON compliance.org_join_code_attempts(ip_address, created_at);

ALTER TABLE compliance.org_join_code_attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.org_join_code_attempts FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_org_join_code_attempts ON compliance.org_join_code_attempts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON compliance.org_join_code_attempts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.org_join_code_attempts TO service_role;
