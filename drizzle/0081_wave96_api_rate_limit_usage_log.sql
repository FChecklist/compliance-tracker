-- Wave 96 (Comparison CSV 3 gap analysis: API002/API009 "Rate Limiting +
-- Usage Analytics"). rate_limit_per_minute is nullable (null = unlimited,
-- every pre-existing key's exact current behavior). api_key_request_log
-- backs both rate-limit enforcement (count of rows in the trailing 60s)
-- and the usage-analytics dashboard -- deliberately does not capture the
-- eventual response status code (see schema.ts comment for why).

ALTER TABLE compliance.api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute integer;

CREATE TABLE IF NOT EXISTS compliance.api_key_request_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  api_key_id text NOT NULL REFERENCES compliance.api_keys(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  route text NOT NULL,
  method text NOT NULL,
  was_rate_limited boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Backs the rate-limit count query (trailing 60s, per key) and the
-- per-org usage dashboard (requests over time, top endpoints).
CREATE INDEX IF NOT EXISTS idx_api_key_request_log_key_created ON compliance.api_key_request_log(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_key_request_log_org_created ON compliance.api_key_request_log(org_id, created_at);

ALTER TABLE compliance.api_key_request_log ENABLE ROW LEVEL SECURITY;

-- Same policy names/shape as api_keys itself (app_runtime_tenant_isolation +
-- service_role_bypass_<table>), for consistency with that table's own
-- existing convention.
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.api_key_request_log FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_api_key_request_log ON compliance.api_key_request_log FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON compliance.api_key_request_log TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.api_key_request_log TO service_role;
