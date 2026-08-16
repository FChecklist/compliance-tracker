-- Wave 173 (GAP-DELEGATION-AUTHORITY). Real, narrow extension of
-- approval_preferences (type-level "always approve this action category")
-- to formal, revocable, time-bounded authority delegation between two
-- people (or a person and a role). RLS follows the same tenant-isolation +
-- service_role-bypass pattern as every other new table this session (e.g.
-- 0143_secure_invite_links.sql) -- AGENTS.md Rule 9: every new table gets
-- real RLS, not just an org_id column.

DO $$ BEGIN
  CREATE TYPE compliance.delegation_scope_type AS ENUM ('task', 'workflow', 'project', 'module', 'communication_type', 'approval_type');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.scoped_delegations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  delegator_user_id text NOT NULL,
  delegate_user_id text,
  delegate_role_key text,
  scope_type compliance.delegation_scope_type NOT NULL,
  scope_id text,
  expires_at timestamp,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scoped_delegations_org ON compliance.scoped_delegations(org_id);
CREATE INDEX IF NOT EXISTS idx_scoped_delegations_delegator ON compliance.scoped_delegations(delegator_user_id);
CREATE INDEX IF NOT EXISTS idx_scoped_delegations_delegate_user ON compliance.scoped_delegations(delegate_user_id);
CREATE INDEX IF NOT EXISTS idx_scoped_delegations_scope ON compliance.scoped_delegations(org_id, scope_type, scope_id);

ALTER TABLE compliance.scoped_delegations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.scoped_delegations FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_scoped_delegations ON compliance.scoped_delegations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
