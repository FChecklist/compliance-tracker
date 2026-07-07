-- Connectors sidebar (Gmail / Google Drive / Google Calendar via Composio,
-- one-click OAuth). Per-user, not per-org -- same RLS posture as
-- personal_model_config (Wave 24): a user may only read/write their own
-- connected accounts.

CREATE TABLE IF NOT EXISTS compliance.connector_accounts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text NOT NULL REFERENCES compliance.users(id),
  toolkit_slug text NOT NULL,
  composio_connected_account_id text NOT NULL,
  status text NOT NULL DEFAULT 'INITIALIZING',
  connected_email text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id, toolkit_slug)
);

ALTER TABLE compliance.connector_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_own_row ON compliance.connector_accounts FOR ALL TO app_runtime
    USING (user_id = compliance.current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_connector_accounts ON compliance.connector_accounts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.connector_accounts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.connector_accounts TO service_role;

CREATE INDEX IF NOT EXISTS idx_connector_accounts_user_id ON compliance.connector_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_connector_accounts_org_id ON compliance.connector_accounts(org_id);
