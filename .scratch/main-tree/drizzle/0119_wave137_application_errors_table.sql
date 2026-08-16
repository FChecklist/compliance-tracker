-- Gap closure, AUDIT_2026-07-09.md (Logging & Monitoring section).
-- Applied live via Supabase MCP apply_migration on 2026-07-09.
--
-- Platform-level error log -- an error can occur before orgId is even
-- resolved, so this is service_role-bypass-only, same posture as
-- loop_executions/token_usage_ledger, not org-scoped.
CREATE TABLE IF NOT EXISTS compliance.application_errors (
  id text PRIMARY KEY,
  route text,
  message text NOT NULL,
  stack text,
  org_id text,
  user_id text,
  digest_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_errors_created_at ON compliance.application_errors (created_at);
CREATE INDEX IF NOT EXISTS idx_application_errors_org_id ON compliance.application_errors (org_id);

ALTER TABLE compliance.application_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.application_errors FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_application_errors ON compliance.application_errors FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.application_errors TO service_role;
