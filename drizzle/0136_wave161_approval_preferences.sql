-- Migration 0136: approval_preferences
-- Tracks per-user approval decisions scoped to org/entity so the
-- system can auto-approve or auto-deny repetitive actions without
-- re-prompting the user.  Part of wave 161 (governance backend).

CREATE TABLE compliance.approval_preferences (
  id              text PRIMARY KEY,
  org_id          text NOT NULL,
  user_id         text NOT NULL,
  scope_type      text NOT NULL,
  scope_id        text,
  action_category text NOT NULL,
  decision        text NOT NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

-- Unique index so we can upsert per (org, user, scope, action)
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_preferences_org_user_scope_action
  ON compliance.approval_preferences (org_id, user_id, scope_type, COALESCE(scope_id, ''), action_category);

-- ============================================================================
-- RLS policies (same pattern as dynamic_chains in 0135)
-- ============================================================================

ALTER TABLE compliance.approval_preferences ENABLE ROW LEVEL SECURITY;

-- app_runtime_tenant_isolation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'compliance'
      AND tablename  = 'approval_preferences'
      AND policyname = 'app_runtime_tenant_isolation'
  ) THEN
    CREATE POLICY app_runtime_tenant_isolation
      ON compliance.approval_preferences
      FOR SELECT
      USING (
        org_id = compliance.current_org_id()
      );
  END IF;
END $$;

-- service_role_bypass_approval_preferences
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'compliance'
      AND tablename  = 'approval_preferences'
      AND policyname = 'service_role_bypass_approval_preferences'
  ) THEN
    CREATE POLICY service_role_bypass_approval_preferences
      ON compliance.approval_preferences
      FOR ALL
      USING (
        coalesce(nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''), '') = 'service_role'
      )
      WITH CHECK (
        coalesce(nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''), '') = 'service_role'
      );
  END IF;
END $$;
