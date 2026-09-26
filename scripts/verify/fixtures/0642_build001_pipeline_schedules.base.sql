-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T18:53:43Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables compliance.users,compliance.submissions,compliance.audit_logs --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key users_department_id_fkey on compliance.users references compliance.departments, not in the snapshot
-- left out: foreign key users_org_id_fkey on compliance.users references compliance.organisations, not in the snapshot
-- left out: foreign key users_org_id_organisations_id_fk on compliance.users references compliance.organisations, not in the snapshot
-- left out: foreign key audit_logs_api_key_id_fkey on compliance.audit_logs references compliance.api_keys, not in the snapshot
-- left out: grant DELETE on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant INSERT on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant MAINTAIN on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant REFERENCES on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant SELECT on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant TRIGGER on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant TRUNCATE on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant UPDATE on compliance.users to compliance_app (role not in the PGlite baseline)
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
CREATE TYPE compliance.user_role AS ENUM ('admin', 'manager', 'member', 'viewer', 'veridian_admin', 'branch_manager', 'senior_professional', 'team_member', 'client_viewer', 'external_auditor', 'stage_0');
CREATE TYPE compliance.submission_status AS ENUM ('chat', 'in_progress', 'done', 'partial', 'failed');
CREATE TYPE compliance.submission_classification AS ENUM ('CHAT_ONLY', 'TASK', 'MULTIPLE_TASKS');
CREATE OR REPLACE FUNCTION compliance.current_org_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'compliance', 'pg_temp'
AS $function$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')
$function$;
CREATE TABLE compliance.users (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role compliance.user_role DEFAULT 'member'::compliance.user_role NOT NULL,
  avatar_url text,
  is_active boolean DEFAULT true NOT NULL,
  last_login_at timestamp with time zone,
  org_id text,
  department_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  onboarding_completed boolean DEFAULT false NOT NULL,
  auth_user_id uuid,
  reporting_to_id text,
  onboarding_stage text DEFAULT 'profile'::text NOT NULL,
  account_stage text,
  passcode_hash text,
  passcode_set_at timestamp with time zone
);
CREATE TABLE compliance.submissions (
  id text NOT NULL,
  org_id text NOT NULL,
  project_id text,
  mode text NOT NULL,
  selected_chain jsonb,
  raw_input text NOT NULL,
  user_id text NOT NULL,
  status compliance.submission_status DEFAULT 'in_progress'::compliance.submission_status NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  classification compliance.submission_classification,
  level smallint,
  source text,
  l0_hit_rate numeric(5,4),
  model_calls integer,
  cache_hits integer,
  level1_outcome text,
  level1_refusal_code text
);
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
  office_id text,
  surface text
);
ALTER TABLE compliance.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE compliance.submissions ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);
ALTER TABLE compliance.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_surface_check CHECK (((surface IS NULL) OR (surface = ANY (ARRAY['s1_one_page_ai_prepared'::text, 's2_erp_screen_prefilled'::text, 's3_ai_link_chat'::text, 's4_email_inbox'::text]))));
ALTER TABLE compliance.submissions ADD CONSTRAINT submissions_level1_outcome_check CHECK (((level1_outcome IS NULL) OR (level1_outcome = ANY (ARRAY['resolved'::text, 'refused'::text, 'not_needed'::text, 'error'::text])))) NOT VALID;
ALTER TABLE compliance.submissions ADD CONSTRAINT submissions_level1_refusal_code_check CHECK (((level1_refusal_code IS NULL) OR (level1_refusal_code = ANY (ARRAY['provider_not_allowed'::text, 'provider_unset'::text, 'user_not_permitted'::text, 'provider_unreachable'::text, 'budget_exceeded'::text, 'unknown'::text])))) NOT VALID;
ALTER TABLE compliance.users ADD CONSTRAINT users_reporting_to_id_fkey FOREIGN KEY (reporting_to_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES compliance.users(id);
CREATE INDEX users_auth_user_id_idx ON compliance.users USING btree (auth_user_id);
CREATE INDEX users_department_id_idx ON compliance.users USING btree (department_id);
CREATE INDEX users_org_id_idx ON compliance.users USING btree (org_id);
CREATE INDEX users_reporting_to_id_idx ON compliance.users USING btree (reporting_to_id);
CREATE INDEX audit_logs_user_id_idx ON compliance.audit_logs USING btree (user_id);
CREATE INDEX idx_audit_logs_api_key_id ON compliance.audit_logs USING btree (api_key_id);
CREATE INDEX idx_audit_logs_org_id ON compliance.audit_logs USING btree (org_id);
CREATE INDEX idx_audit_logs_support_session_id ON compliance.audit_logs USING btree (support_session_id) WHERE (support_session_id IS NOT NULL);
CREATE INDEX idx_ct2_audit_logs_created ON compliance.audit_logs USING btree (created_at);
CREATE INDEX idx_ct2_audit_logs_entity ON compliance.audit_logs USING btree (entity_type, entity_id);
CREATE INDEX submissions_org_user_idx ON compliance.submissions USING btree (org_id, user_id);
ALTER TABLE compliance.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.users FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_preauth_insert_users ON compliance.users AS PERMISSIVE FOR INSERT TO app_runtime WITH CHECK ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_preauth_read_users ON compliance.users AS PERMISSIVE FOR SELECT TO app_runtime USING ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_preauth_update_users ON compliance.users AS PERMISSIVE FOR UPDATE TO app_runtime USING ((compliance.current_org_id() IS NULL)) WITH CHECK ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_tenant_isolation ON compliance.users AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_compliance_users ON compliance.users AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.audit_logs AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_audit_logs ON compliance.audit_logs AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.submissions AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_submissions ON compliance.submissions AS PERMISSIVE FOR ALL TO service_role USING (true);
GRANT DELETE ON TABLE compliance.users TO app_runtime;
GRANT INSERT ON TABLE compliance.users TO app_runtime;
GRANT SELECT ON TABLE compliance.users TO app_runtime;
GRANT UPDATE ON TABLE compliance.users TO app_runtime;
GRANT DELETE ON TABLE compliance.users TO service_role;
GRANT INSERT ON TABLE compliance.users TO service_role;
GRANT SELECT ON TABLE compliance.users TO service_role;
GRANT UPDATE ON TABLE compliance.users TO service_role;
GRANT INSERT ON TABLE compliance.audit_logs TO app_runtime;
GRANT SELECT ON TABLE compliance.audit_logs TO app_runtime;
GRANT INSERT ON TABLE compliance.audit_logs TO service_role;
GRANT SELECT ON TABLE compliance.audit_logs TO service_role;
GRANT DELETE ON TABLE compliance.submissions TO app_runtime;
GRANT INSERT ON TABLE compliance.submissions TO app_runtime;
GRANT SELECT ON TABLE compliance.submissions TO app_runtime;
GRANT UPDATE ON TABLE compliance.submissions TO app_runtime;
GRANT DELETE ON TABLE compliance.submissions TO service_role;
GRANT INSERT ON TABLE compliance.submissions TO service_role;
GRANT SELECT ON TABLE compliance.submissions TO service_role;
GRANT UPDATE ON TABLE compliance.submissions TO service_role;
RESET check_function_bodies;
