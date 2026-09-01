CREATE TABLE IF NOT EXISTS compliance.report_share_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  report_type text NOT NULL,
  report_ref text NOT NULL,
  token text NOT NULL UNIQUE,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.report_share_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.report_share_links FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_report_share_links ON compliance.report_share_links FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_share_links TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.report_share_links TO service_role;
