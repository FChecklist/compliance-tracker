-- Wave 161 (VERI_CHAT_GOVERNANCE.md, "VERI-Assisted Communication
-- Protocol"). Additive only. Application-layer dedup (find-then-insert-or-
-- update in approval-preference-service.ts), not a DB-level ON CONFLICT --
-- a unique index over the nullable scope_id column doesn't match NULL to
-- NULL the way a naive upsert target would assume, so no such index is
-- declared here; correctness is enforced in the service layer instead.

CREATE TABLE IF NOT EXISTS compliance.approval_preferences (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text NOT NULL,
  scope_type text NOT NULL, -- 'communication_type' | 'conversation' | 'task' | 'workflow'
  scope_id text,
  action_category text NOT NULL,
  decision text NOT NULL, -- 'always_approve' | 'always_reject'
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_preferences_lookup ON compliance.approval_preferences(org_id, user_id, action_category, scope_type, scope_id);

ALTER TABLE compliance.approval_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.approval_preferences FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_approval_preferences ON compliance.approval_preferences FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
