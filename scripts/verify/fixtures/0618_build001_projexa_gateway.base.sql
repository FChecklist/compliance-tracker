-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T11:58:02Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables compliance.users,compliance.projects,compliance.construction_boqs,compliance.construction_boq_line_items --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key users_department_id_fkey on compliance.users references compliance.departments, not in the snapshot
-- left out: foreign key users_org_id_fkey on compliance.users references compliance.organisations, not in the snapshot
-- left out: foreign key users_org_id_organisations_id_fk on compliance.users references compliance.organisations, not in the snapshot
-- left out: foreign key projects_client_id_fkey on compliance.projects references compliance.clients, not in the snapshot
-- left out: foreign key projects_org_id_fkey on compliance.projects references compliance.organisations, not in the snapshot
-- left out: foreign key projects_product_id_fkey on compliance.projects references compliance.products, not in the snapshot
-- left out: grant DELETE on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant INSERT on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant MAINTAIN on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant REFERENCES on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant SELECT on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant TRIGGER on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant TRUNCATE on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant UPDATE on compliance.users to compliance_app (role not in the PGlite baseline)
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE TYPE compliance.user_role AS ENUM ('admin', 'manager', 'member', 'viewer', 'veridian_admin', 'branch_manager', 'senior_professional', 'team_member', 'client_viewer', 'external_auditor', 'stage_0');
CREATE TYPE compliance.pms_project_status AS ENUM ('planning', 'active', 'paused', 'completed', 'cancelled');
CREATE TYPE compliance.pms_project_access AS ENUM ('private', 'public');
CREATE TYPE compliance.construction_boq_status AS ENUM ('draft', 'submitted', 'approved', 'superseded');
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
CREATE TABLE compliance.projects (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  product_id text NOT NULL,
  org_id text NOT NULL,
  client_id text,
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  issue_prefix text,
  issue_sequence integer DEFAULT 0 NOT NULL,
  lead_user_id text,
  start_date date,
  target_date date,
  health_status text,
  parent_project_id text,
  project_value numeric,
  status compliance.pms_project_status DEFAULT 'active'::compliance.pms_project_status NOT NULL,
  access_level compliance.pms_project_access DEFAULT 'public'::compliance.pms_project_access NOT NULL,
  rollup_percentage integer DEFAULT 0 NOT NULL,
  custom_tabs jsonb DEFAULT '[]'::jsonb NOT NULL,
  vat_rate_percent numeric DEFAULT 5 NOT NULL,
  retention_percent numeric DEFAULT 5 NOT NULL
);
CREATE TABLE compliance.construction_boqs (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  parent_boq_id text,
  title text NOT NULL,
  status compliance.construction_boq_status DEFAULT 'draft'::compliance.construction_boq_status NOT NULL,
  created_by_id text NOT NULL,
  approved_by_id text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  contract_value_override numeric,
  override_actor_id text,
  override_at timestamp without time zone,
  override_reason text,
  evidence_artefact_ref text,
  customer_approved_by_id text,
  customer_approved_at timestamp without time zone,
  customer_esignature_request_id text
);
CREATE TABLE compliance.construction_boq_line_items (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  boq_id text NOT NULL,
  activity_id text,
  item_code text,
  description text NOT NULL,
  unit text NOT NULL,
  quantity numeric DEFAULT 0 NOT NULL,
  rate numeric DEFAULT 0 NOT NULL,
  amount numeric DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  material_cost numeric,
  labour_cost numeric,
  equipment_cost numeric,
  overhead_percent numeric,
  profit_percent numeric,
  parent_line_item_id text,
  breakdown_percentage numeric,
  org_id text NOT NULL,
  budget_percentage numeric DEFAULT '25'::numeric NOT NULL,
  vendor_id text,
  vendor_amount numeric,
  material_amount numeric,
  manpower_amount numeric,
  category text,
  qty_project numeric,
  rate_project numeric,
  qty_contract numeric,
  rate_contract numeric
);
ALTER TABLE compliance.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_boqs ADD CONSTRAINT construction_boqs_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_boq_line_items ADD CONSTRAINT construction_boq_line_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE compliance.construction_boqs ADD CONSTRAINT construction_boqs_parent_boq_id_unique UNIQUE (parent_boq_id);
ALTER TABLE compliance.users ADD CONSTRAINT users_reporting_to_id_fkey FOREIGN KEY (reporting_to_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_lead_user_id_fkey FOREIGN KEY (lead_user_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_parent_project_id_fkey FOREIGN KEY (parent_project_id) REFERENCES compliance.projects(id);
CREATE INDEX users_auth_user_id_idx ON compliance.users USING btree (auth_user_id);
CREATE INDEX users_department_id_idx ON compliance.users USING btree (department_id);
CREATE INDEX users_org_id_idx ON compliance.users USING btree (org_id);
CREATE INDEX users_reporting_to_id_idx ON compliance.users USING btree (reporting_to_id);
CREATE INDEX idx_projects_client_id ON compliance.projects USING btree (client_id);
CREATE INDEX idx_projects_lead_user_id ON compliance.projects USING btree (lead_user_id);
CREATE INDEX idx_projects_org_id ON compliance.projects USING btree (org_id);
CREATE INDEX idx_projects_parent_project_id ON compliance.projects USING btree (parent_project_id);
CREATE INDEX idx_projects_product_id ON compliance.projects USING btree (product_id);
CREATE INDEX projects_access_level_idx ON compliance.projects USING btree (org_id, access_level);
CREATE INDEX idx_construction_boqs_org_project ON compliance.construction_boqs USING btree (org_id, project_id);
CREATE INDEX construction_boq_line_items_boq_category_idx ON compliance.construction_boq_line_items USING btree (boq_id, category);
CREATE INDEX construction_boq_line_items_parent_line_item_id_idx ON compliance.construction_boq_line_items USING btree (parent_line_item_id);
CREATE INDEX idx_construction_boq_line_items_boq_id ON compliance.construction_boq_line_items USING btree (boq_id);
CREATE INDEX idx_construction_boq_line_items_org_id ON compliance.construction_boq_line_items USING btree (org_id);
ALTER TABLE compliance.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.users FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boqs FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boq_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boq_line_items FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_preauth_insert_users ON compliance.users AS PERMISSIVE FOR INSERT TO app_runtime WITH CHECK ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_preauth_read_users ON compliance.users AS PERMISSIVE FOR SELECT TO app_runtime USING ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_preauth_update_users ON compliance.users AS PERMISSIVE FOR UPDATE TO app_runtime USING ((compliance.current_org_id() IS NULL)) WITH CHECK ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_tenant_isolation ON compliance.users AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_compliance_users ON compliance.users AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_org_scoped ON compliance.projects AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_projects ON compliance.projects AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_boqs AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_boqs ON compliance.construction_boqs AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_boq_line_items AS PERMISSIVE FOR ALL TO app_runtime USING ((EXISTS ( SELECT 1
   FROM compliance.construction_boqs b
  WHERE ((b.id = construction_boq_line_items.boq_id) AND (b.org_id = compliance.current_org_id())))));
CREATE POLICY service_role_bypass_construction_boq_line_items ON compliance.construction_boq_line_items AS PERMISSIVE FOR ALL TO service_role USING (true);
GRANT DELETE ON TABLE compliance.users TO app_runtime;
GRANT INSERT ON TABLE compliance.users TO app_runtime;
GRANT SELECT ON TABLE compliance.users TO app_runtime;
GRANT UPDATE ON TABLE compliance.users TO app_runtime;
GRANT DELETE ON TABLE compliance.users TO service_role;
GRANT INSERT ON TABLE compliance.users TO service_role;
GRANT SELECT ON TABLE compliance.users TO service_role;
GRANT UPDATE ON TABLE compliance.users TO service_role;
GRANT DELETE ON TABLE compliance.projects TO app_runtime;
GRANT INSERT ON TABLE compliance.projects TO app_runtime;
GRANT SELECT ON TABLE compliance.projects TO app_runtime;
GRANT UPDATE ON TABLE compliance.projects TO app_runtime;
GRANT DELETE ON TABLE compliance.projects TO service_role;
GRANT INSERT ON TABLE compliance.projects TO service_role;
GRANT SELECT ON TABLE compliance.projects TO service_role;
GRANT UPDATE ON TABLE compliance.projects TO service_role;
GRANT DELETE ON TABLE compliance.construction_boqs TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_boqs TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_boqs TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_boqs TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_boqs TO service_role;
GRANT INSERT ON TABLE compliance.construction_boqs TO service_role;
GRANT SELECT ON TABLE compliance.construction_boqs TO service_role;
GRANT UPDATE ON TABLE compliance.construction_boqs TO service_role;
GRANT DELETE ON TABLE compliance.construction_boq_line_items TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_boq_line_items TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_boq_line_items TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_boq_line_items TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_boq_line_items TO service_role;
GRANT INSERT ON TABLE compliance.construction_boq_line_items TO service_role;
GRANT SELECT ON TABLE compliance.construction_boq_line_items TO service_role;
GRANT UPDATE ON TABLE compliance.construction_boq_line_items TO service_role;
RESET check_function_bodies;
