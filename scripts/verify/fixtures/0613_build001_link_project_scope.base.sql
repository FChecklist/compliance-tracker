-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T10:24:05Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables platform.user_ai_links,compliance.api_keys --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key api_keys_issued_for_application_id_fkey on compliance.api_keys references compliance.platform_applications, not in the snapshot
-- left out: foreign key api_keys_org_id_fkey on compliance.api_keys references compliance.organisations, not in the snapshot
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE OR REPLACE FUNCTION compliance.current_org_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'compliance', 'pg_temp'
AS $function$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')
$function$;
CREATE TABLE platform.user_ai_links (
  id text NOT NULL,
  org_id text NOT NULL,
  user_id text NOT NULL,
  token text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone
);
CREATE TABLE compliance.api_keys (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  org_id text NOT NULL,
  scopes text DEFAULT 'read'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  domain_scope text,
  rate_limit_per_minute integer,
  issued_for_application_id text
);
ALTER TABLE compliance.api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_pkey PRIMARY KEY (id);
ALTER TABLE compliance.api_keys ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_token_key UNIQUE (token);
CREATE INDEX api_keys_org_id_idx ON compliance.api_keys USING btree (org_id);
CREATE INDEX idx_api_keys_issued_for_application_id ON compliance.api_keys USING btree (issued_for_application_id);
CREATE UNIQUE INDEX user_ai_links_one_active_per_user ON platform.user_ai_links USING btree (org_id, user_id) WHERE (status = 'active'::text);
CREATE INDEX user_ai_links_token_idx ON platform.user_ai_links USING btree (token) WHERE (status = 'active'::text);
ALTER TABLE platform.user_ai_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_preauth_read_api_keys ON compliance.api_keys AS PERMISSIVE FOR SELECT TO app_runtime USING ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_preauth_update_api_keys_last_used ON compliance.api_keys AS PERMISSIVE FOR UPDATE TO app_runtime USING ((compliance.current_org_id() IS NULL)) WITH CHECK ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_tenant_isolation ON compliance.api_keys AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_api_keys ON compliance.api_keys AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_org_scoped ON platform.user_ai_links AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
GRANT DELETE ON TABLE compliance.api_keys TO app_runtime;
GRANT INSERT ON TABLE compliance.api_keys TO app_runtime;
GRANT SELECT ON TABLE compliance.api_keys TO app_runtime;
GRANT UPDATE ON TABLE compliance.api_keys TO app_runtime;
GRANT DELETE ON TABLE compliance.api_keys TO service_role;
GRANT INSERT ON TABLE compliance.api_keys TO service_role;
GRANT SELECT ON TABLE compliance.api_keys TO service_role;
GRANT UPDATE ON TABLE compliance.api_keys TO service_role;
GRANT DELETE ON TABLE platform.user_ai_links TO app_runtime;
GRANT INSERT ON TABLE platform.user_ai_links TO app_runtime;
GRANT SELECT ON TABLE platform.user_ai_links TO app_runtime;
GRANT UPDATE ON TABLE platform.user_ai_links TO app_runtime;
GRANT DELETE ON TABLE platform.user_ai_links TO service_role;
GRANT INSERT ON TABLE platform.user_ai_links TO service_role;
GRANT SELECT ON TABLE platform.user_ai_links TO service_role;
GRANT UPDATE ON TABLE platform.user_ai_links TO service_role;
RESET check_function_bodies;
