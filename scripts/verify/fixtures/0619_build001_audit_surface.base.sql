-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T14:02:43Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables compliance.audit_logs --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key audit_logs_api_key_id_fkey on compliance.audit_logs references compliance.api_keys, not in the snapshot
-- left out: foreign key audit_logs_user_id_fkey on compliance.audit_logs references compliance.users, not in the snapshot
-- left out: grant DELETE on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
-- left out: grant INSERT on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
-- left out: grant MAINTAIN on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
-- left out: grant REFERENCES on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
-- left out: grant SELECT on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
-- left out: grant TRIGGER on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
-- left out: grant TRUNCATE on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
-- left out: grant UPDATE on compliance.audit_logs to compliance_app (role not in the PGlite baseline)
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE OR REPLACE FUNCTION compliance.current_org_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'compliance', 'pg_temp'
AS $function$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')
$function$;
CREATE TABLE compliance.audit_logs (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  user_id text,
  details text,
  ip_address text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  org_id text NOT NULL,
  client_id text,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  user_agent text,
  api_key_id text,
  support_session_id text,
  acting_on_behalf_of_user_id text,
  session_id text,
  office_id text
);
ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
CREATE INDEX audit_logs_user_id_idx ON compliance.audit_logs USING btree (user_id);
CREATE INDEX idx_audit_logs_api_key_id ON compliance.audit_logs USING btree (api_key_id);
CREATE INDEX idx_audit_logs_org_id ON compliance.audit_logs USING btree (org_id);
CREATE INDEX idx_audit_logs_support_session_id ON compliance.audit_logs USING btree (support_session_id) WHERE (support_session_id IS NOT NULL);
CREATE INDEX idx_ct2_audit_logs_created ON compliance.audit_logs USING btree (created_at);
CREATE INDEX idx_ct2_audit_logs_entity ON compliance.audit_logs USING btree (entity_type, entity_id);
ALTER TABLE compliance.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_tenant_isolation ON compliance.audit_logs AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_audit_logs ON compliance.audit_logs AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT INSERT ON TABLE compliance.audit_logs TO app_runtime;
GRANT SELECT ON TABLE compliance.audit_logs TO app_runtime;
GRANT INSERT ON TABLE compliance.audit_logs TO service_role;
GRANT SELECT ON TABLE compliance.audit_logs TO service_role;
RESET check_function_bodies;
