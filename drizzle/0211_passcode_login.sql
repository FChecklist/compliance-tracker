-- Priority 14 Wave 2 (GAP-AUTH-REBUILD, Owner directive 2026-07-14/15):
-- additive 4-digit return-login passcode. Alongside magic-link/Google-OAuth/
-- password/SSO, never a replacement -- opt-in from Settings, only available
-- to a user who already has a real compliance.users row (first-time signup
-- still requires one of the existing identity-proving methods). See
-- src/lib/passcode-login-service.ts for the full security-property writeup
-- (bcrypt hashing, dual email+IP rate limiting, no recovery capability).
-- Purely additive: nullable columns, IF NOT EXISTS everywhere -- every
-- existing row and route is unaffected until a real user opts in.

-- users.passcode_hash: bcrypt hash of the 4-digit passcode, null = not
-- enabled. Deliberately NOT reusing the legacy users.password_hash column
-- (every existing row's value there is the literal placeholder string
-- "supabase-auth-managed" -- see schema.ts's comment on this column for
-- the full reasoning against overloading it).
ALTER TABLE compliance.users ADD COLUMN IF NOT EXISTS passcode_hash text;
ALTER TABLE compliance.users ADD COLUMN IF NOT EXISTS passcode_set_at timestamp;

-- Rate-limit log for POST /api/auth/passcode-login. Keyed by BOTH email and
-- ip_address (org_join_code_attempts precedent is IP-only, but a 4-digit
-- passcode's ~10,000-value keyspace needs a per-target-account limit that
-- survives IP rotation -- see passcode-login-service.ts's
-- checkPasscodeRateLimit). No org_id column: unlike a join code, a
-- passcode-login attempt has no org to resolve to until AFTER a successful
-- email+passcode match, and by that point the attempt has already
-- succeeded -- there is no meaningful "attempt matched this org but failed"
-- state the way an org join code (which is itself org-scoped) has.
CREATE TABLE IF NOT EXISTS compliance.passcode_login_attempts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email text NOT NULL,
  ip_address text NOT NULL,
  was_successful boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Backs the two trailing-window rate-limit count queries (per-email,
-- per-IP).
CREATE INDEX IF NOT EXISTS idx_passcode_login_attempts_email_created ON compliance.passcode_login_attempts(email, created_at);
CREATE INDEX IF NOT EXISTS idx_passcode_login_attempts_ip_created ON compliance.passcode_login_attempts(ip_address, created_at);

ALTER TABLE compliance.passcode_login_attempts ENABLE ROW LEVEL SECURITY;

-- No org-scoped tenant-isolation policy here (unlike every other table's
-- app_runtime_tenant_isolation) -- there is no org_id column to scope by,
-- per the comment above, and no app_runtime (tenant-scoped) call site ever
-- reads/writes this table: the passcode-login route's rate-limit check and
-- attempt log both run through the raw, RLS-bypassing `db` client (same
-- pre-auth posture as org_join_code_attempts's own equivalent calls), never
-- through withTenantContext(). service_role-only is a deliberate, narrower
-- default than platform_applications' app_runtime-read-true precedent
-- (0203) -- this table logs raw attempted email addresses, and nothing in
-- the app actually needs app_runtime-role access to it, so RLS defaults to
-- deny for that role (AGENTS.md Rule 9: enabling RLS with no permissive
-- policy for a role is the safe default, matched here rather than adding
-- an unused grant).
DO $$ BEGIN
  CREATE POLICY service_role_bypass_passcode_login_attempts ON compliance.passcode_login_attempts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON compliance.passcode_login_attempts TO service_role;
