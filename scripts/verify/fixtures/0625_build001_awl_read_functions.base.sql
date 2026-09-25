-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T17:44:15Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables platform.user_ai_links,compliance.users,compliance.projects,compliance.project_team_members,compliance.construction_boqs,compliance.construction_boq_line_items,compliance.construction_activities,compliance.construction_work_progress_entries,compliance.pms_issues,compliance.pms_meetings,compliance.documents,compliance.construction_labour_roster,compliance.construction_attendance,compliance.pms_time_entries,compliance.pipeline_tasks,compliance.submissions,compliance.cost_visibility_config --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key users_department_id_fkey on compliance.users references compliance.departments, not in the snapshot
-- left out: foreign key users_org_id_fkey on compliance.users references compliance.organisations, not in the snapshot
-- left out: foreign key users_org_id_organisations_id_fk on compliance.users references compliance.organisations, not in the snapshot
-- left out: foreign key documents_client_id_fkey on compliance.documents references compliance.clients, not in the snapshot
-- left out: foreign key documents_compliance_item_id_fkey on compliance.documents references compliance.compliance_items, not in the snapshot
-- left out: foreign key documents_correspondent_id_fkey on compliance.documents references compliance.document_correspondents, not in the snapshot
-- left out: foreign key documents_notice_id_fkey on compliance.documents references compliance.notices, not in the snapshot
-- left out: foreign key documents_source_object_id_fkey on compliance.documents references compliance.source_object, not in the snapshot
-- left out: foreign key projects_client_id_fkey on compliance.projects references compliance.clients, not in the snapshot
-- left out: foreign key projects_org_id_fkey on compliance.projects references compliance.organisations, not in the snapshot
-- left out: foreign key projects_product_id_fkey on compliance.projects references compliance.products, not in the snapshot
-- left out: foreign key pms_issues_client_id_fkey on compliance.pms_issues references compliance.clients, not in the snapshot
-- left out: foreign key pms_issues_estimate_point_id_fkey on compliance.pms_issues references compliance.pms_estimate_points, not in the snapshot
-- left out: foreign key pms_issues_milestone_id_fkey on compliance.pms_issues references compliance.pms_milestones, not in the snapshot
-- left out: foreign key pms_issues_org_id_fkey on compliance.pms_issues references compliance.organisations, not in the snapshot
-- left out: foreign key pms_issues_status_id_fkey on compliance.pms_issues references compliance.pms_issue_statuses, not in the snapshot
-- left out: foreign key pms_issues_type_id_fkey on compliance.pms_issues references compliance.pms_issue_types, not in the snapshot
-- left out: foreign key pms_time_entries_invoice_item_id_fkey on compliance.pms_time_entries references compliance.erp_sales_invoice_items, not in the snapshot
-- left out: foreign key pms_time_entries_org_id_fkey on compliance.pms_time_entries references compliance.organisations, not in the snapshot
-- left out: foreign key pms_meetings_org_id_fkey on compliance.pms_meetings references compliance.organisations, not in the snapshot
-- left out: grant DELETE on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant INSERT on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant MAINTAIN on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant REFERENCES on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant SELECT on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant TRIGGER on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant TRUNCATE on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant UPDATE on compliance.users to compliance_app (role not in the PGlite baseline)
-- left out: grant DELETE on compliance.documents to compliance_app (role not in the PGlite baseline)
-- left out: grant INSERT on compliance.documents to compliance_app (role not in the PGlite baseline)
-- left out: grant MAINTAIN on compliance.documents to compliance_app (role not in the PGlite baseline)
-- left out: grant REFERENCES on compliance.documents to compliance_app (role not in the PGlite baseline)
-- left out: grant SELECT on compliance.documents to compliance_app (role not in the PGlite baseline)
-- left out: grant TRIGGER on compliance.documents to compliance_app (role not in the PGlite baseline)
-- left out: grant TRUNCATE on compliance.documents to compliance_app (role not in the PGlite baseline)
-- left out: grant UPDATE on compliance.documents to compliance_app (role not in the PGlite baseline)
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE TYPE compliance.user_role AS ENUM ('admin', 'manager', 'member', 'viewer', 'veridian_admin', 'branch_manager', 'senior_professional', 'team_member', 'client_viewer', 'external_auditor', 'stage_0');
CREATE TYPE compliance.pms_project_status AS ENUM ('planning', 'active', 'paused', 'completed', 'cancelled');
CREATE TYPE compliance.pms_project_access AS ENUM ('private', 'public');
CREATE TYPE compliance.construction_boq_status AS ENUM ('draft', 'submitted', 'approved', 'superseded');
CREATE TYPE compliance.pms_issue_priority AS ENUM ('no_priority', 'urgent', 'high', 'medium', 'low');
CREATE TYPE compliance.construction_attendance_status AS ENUM ('present', 'absent', 'half_day');
CREATE TYPE compliance.pms_time_entry_approval_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
CREATE TYPE compliance.pipeline_task_project_source AS ENUM ('inherited', 'stated');
CREATE TYPE compliance.pipeline_task_executor AS ENUM ('software', 'ai', 'person');
CREATE TYPE compliance.pipeline_task_status AS ENUM ('to_do', 'in_progress', 'waiting', 'done', 'blocked');
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
CREATE TABLE platform.user_ai_links (
  id text NOT NULL,
  org_id text NOT NULL,
  user_id text NOT NULL,
  token text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  product text DEFAULT 'veridian'::text NOT NULL,
  project_id text,
  token_hash text,
  authority_level smallint DEFAULT 0 NOT NULL,
  allowed_functions text[] DEFAULT '{}'::text[] NOT NULL,
  hide_personal boolean DEFAULT true NOT NULL,
  label text,
  expires_at timestamp with time zone,
  created_by_user_id text,
  call_count integer DEFAULT 0 NOT NULL,
  write_count integer DEFAULT 0 NOT NULL
);
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
CREATE TABLE compliance.project_team_members (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  user_id text NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE compliance.construction_activities (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  category_id text NOT NULL,
  name text NOT NULL,
  unit text,
  planned_quantity numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_work_progress_entries (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  activity_id text NOT NULL,
  entry_date date NOT NULL,
  quantity_done numeric DEFAULT 0 NOT NULL,
  percent_complete numeric DEFAULT 0 NOT NULL,
  remarks text,
  recorded_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  boq_line_item_id text,
  entry_basis text DEFAULT 'DELTA'::text NOT NULL,
  drawing_document_id text,
  drawing_confirmed_by_id text,
  drawing_confirmed_at timestamp without time zone
);
CREATE TABLE compliance.pms_issues (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  client_id text,
  project_id text NOT NULL,
  type_id text NOT NULL,
  status_id text NOT NULL,
  priority compliance.pms_issue_priority DEFAULT 'no_priority'::compliance.pms_issue_priority NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  description text,
  assignee_id text,
  parent_issue_id text,
  milestone_id text,
  estimate_point_id text,
  start_date date,
  due_date date,
  position numeric DEFAULT 0 NOT NULL,
  is_archived boolean DEFAULT false NOT NULL,
  created_by_id text,
  assigned_by_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  completion_percentage integer DEFAULT 0 NOT NULL,
  completion_source text DEFAULT 'manual'::text NOT NULL,
  completed_from_entry_id text
);
CREATE TABLE compliance.pms_meetings (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  title text NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  duration_minutes integer,
  recurrence_rule text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.documents (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size integer,
  compliance_item_id text,
  uploaded_by_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  client_id text,
  notice_id text,
  extracted_data jsonb,
  org_id text NOT NULL,
  category text,
  expiry_date timestamp with time zone,
  linked_entity_type text,
  linked_entity_id text,
  parent_document_id text,
  version_number integer DEFAULT 1 NOT NULL,
  is_latest_version boolean DEFAULT true NOT NULL,
  retention_period_days integer,
  disposal_date date,
  legal_hold boolean DEFAULT false NOT NULL,
  is_disposed boolean DEFAULT false NOT NULL,
  disposed_at timestamp with time zone,
  disposed_by_id text,
  metadata jsonb,
  correspondent_id text,
  tags jsonb DEFAULT '[]'::jsonb NOT NULL,
  auto_classified boolean DEFAULT false NOT NULL,
  source_object_id text
);
CREATE TABLE compliance.construction_labour_roster (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  trade text,
  skill_level text,
  vendor_id text,
  daily_rate numeric DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  employee_code text,
  employee_id text
);
CREATE TABLE compliance.construction_attendance (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  roster_id text NOT NULL,
  attendance_date date NOT NULL,
  status compliance.construction_attendance_status DEFAULT 'present'::compliance.construction_attendance_status NOT NULL,
  hours_worked numeric,
  daily_cost numeric DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.pms_time_entries (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  issue_id text NOT NULL,
  user_id text NOT NULL,
  hours numeric NOT NULL,
  spent_on date NOT NULL,
  activity_type text,
  comments text,
  is_running boolean DEFAULT false NOT NULL,
  started_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  billable boolean DEFAULT true NOT NULL,
  hourly_rate_snapshot numeric,
  invoice_item_id text,
  approval_status compliance.pms_time_entry_approval_status DEFAULT 'draft'::compliance.pms_time_entry_approval_status NOT NULL,
  approved_by_id text,
  approved_at timestamp with time zone,
  rejection_reason text
);
CREATE TABLE compliance.pipeline_tasks (
  id text NOT NULL,
  submission_id text NOT NULL,
  sequence integer NOT NULL,
  depends_on text,
  org_id text NOT NULL,
  project_id text,
  project_source compliance.pipeline_task_project_source NOT NULL,
  derived_chain jsonb,
  function_id text,
  params jsonb DEFAULT '{}'::jsonb NOT NULL,
  chain_matched_hint boolean DEFAULT false NOT NULL,
  executor compliance.pipeline_task_executor DEFAULT 'software'::compliance.pipeline_task_executor NOT NULL,
  status compliance.pipeline_task_status DEFAULT 'to_do'::compliance.pipeline_task_status NOT NULL,
  result jsonb,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  error_code text,
  error_params jsonb
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
CREATE TABLE compliance.cost_visibility_config (
  id text NOT NULL,
  org_id text NOT NULL,
  role compliance.user_role NOT NULL,
  can_see_cost boolean DEFAULT false NOT NULL,
  changed_by_id text NOT NULL,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE compliance.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE compliance.documents ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE compliance.pms_issues ADD CONSTRAINT pms_issues_pkey PRIMARY KEY (id);
ALTER TABLE compliance.pms_time_entries ADD CONSTRAINT pms_time_entries_pkey PRIMARY KEY (id);
ALTER TABLE compliance.pms_meetings ADD CONSTRAINT pms_meetings_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_boqs ADD CONSTRAINT construction_boqs_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_boq_line_items ADD CONSTRAINT construction_boq_line_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_activities ADD CONSTRAINT construction_activities_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_work_progress_entries ADD CONSTRAINT construction_work_progress_entries_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_labour_roster ADD CONSTRAINT construction_labour_roster_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_attendance ADD CONSTRAINT construction_attendance_pkey PRIMARY KEY (id);
ALTER TABLE compliance.submissions ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);
ALTER TABLE compliance.pipeline_tasks ADD CONSTRAINT pipeline_tasks_pkey PRIMARY KEY (id);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_pkey PRIMARY KEY (id);
ALTER TABLE compliance.project_team_members ADD CONSTRAINT project_team_members_pkey PRIMARY KEY (id);
ALTER TABLE compliance.cost_visibility_config ADD CONSTRAINT cost_visibility_config_pkey PRIMARY KEY (id);
ALTER TABLE compliance.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE compliance.pms_issues ADD CONSTRAINT pms_issues_project_id_number_key UNIQUE (project_id, number);
ALTER TABLE compliance.construction_boqs ADD CONSTRAINT construction_boqs_parent_boq_id_unique UNIQUE (parent_boq_id);
ALTER TABLE compliance.construction_attendance ADD CONSTRAINT construction_attendance_roster_date_unique UNIQUE (roster_id, attendance_date);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_token_hash_key UNIQUE (token_hash);
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_token_key UNIQUE (token);
ALTER TABLE compliance.project_team_members ADD CONSTRAINT project_team_members_project_id_user_id_key UNIQUE (project_id, user_id);
ALTER TABLE compliance.cost_visibility_config ADD CONSTRAINT cost_visibility_config_org_role_unique UNIQUE (org_id, role);
ALTER TABLE compliance.construction_work_progress_entries ADD CONSTRAINT construction_work_progress_entries_entry_basis_check CHECK ((entry_basis = ANY (ARRAY['DELTA'::text, 'SNAPSHOT'::text])));
ALTER TABLE compliance.submissions ADD CONSTRAINT submissions_level1_outcome_check CHECK (((level1_outcome IS NULL) OR (level1_outcome = ANY (ARRAY['resolved'::text, 'refused'::text, 'not_needed'::text, 'error'::text])))) NOT VALID;
ALTER TABLE compliance.submissions ADD CONSTRAINT submissions_level1_refusal_code_check CHECK (((level1_refusal_code IS NULL) OR (level1_refusal_code = ANY (ARRAY['provider_not_allowed'::text, 'provider_unset'::text, 'user_not_permitted'::text, 'provider_unreachable'::text, 'budget_exceeded'::text, 'unknown'::text])))) NOT VALID;
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_authority_level_check CHECK ((authority_level = ANY (ARRAY[0, 1])));
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_product_check CHECK ((product = ANY (ARRAY['veridian'::text, 'projexa'::text])));
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_projexa_shape CHECK (((product = 'veridian'::text) OR ((project_id IS NOT NULL) AND (token_hash IS NOT NULL) AND (token IS NULL) AND (expires_at IS NOT NULL))));
ALTER TABLE compliance.cost_visibility_config ADD CONSTRAINT cost_visibility_config_no_client_viewer_grant CHECK ((NOT ((role = 'client_viewer'::compliance.user_role) AND (can_see_cost = true))));
ALTER TABLE compliance.users ADD CONSTRAINT users_reporting_to_id_fkey FOREIGN KEY (reporting_to_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.documents ADD CONSTRAINT documents_uploaded_by_id_fkey FOREIGN KEY (uploaded_by_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_lead_user_id_fkey FOREIGN KEY (lead_user_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_parent_project_id_fkey FOREIGN KEY (parent_project_id) REFERENCES compliance.projects(id);
ALTER TABLE compliance.pms_issues ADD CONSTRAINT pms_issues_assigned_by_id_fkey FOREIGN KEY (assigned_by_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.pms_issues ADD CONSTRAINT pms_issues_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.pms_issues ADD CONSTRAINT pms_issues_parent_issue_id_fkey FOREIGN KEY (parent_issue_id) REFERENCES compliance.pms_issues(id);
ALTER TABLE compliance.pms_issues ADD CONSTRAINT pms_issues_project_id_fkey FOREIGN KEY (project_id) REFERENCES compliance.projects(id);
ALTER TABLE compliance.pms_time_entries ADD CONSTRAINT pms_time_entries_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES compliance.pms_issues(id);
ALTER TABLE compliance.pms_time_entries ADD CONSTRAINT pms_time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES compliance.users(id);
ALTER TABLE compliance.pms_meetings ADD CONSTRAINT pms_meetings_project_id_fkey FOREIGN KEY (project_id) REFERENCES compliance.projects(id);
ALTER TABLE compliance.construction_work_progress_entries ADD CONSTRAINT construction_work_progress_entries_boq_line_item_id_fkey FOREIGN KEY (boq_line_item_id) REFERENCES compliance.construction_boq_line_items(id) ON DELETE SET NULL;
ALTER TABLE compliance.pipeline_tasks ADD CONSTRAINT pipeline_tasks_depends_on_pipeline_tasks_id_fk FOREIGN KEY (depends_on) REFERENCES compliance.pipeline_tasks(id) ON DELETE SET NULL;
ALTER TABLE compliance.pipeline_tasks ADD CONSTRAINT pipeline_tasks_submission_id_submissions_id_fk FOREIGN KEY (submission_id) REFERENCES compliance.submissions(id) ON DELETE CASCADE;
CREATE INDEX users_auth_user_id_idx ON compliance.users USING btree (auth_user_id);
CREATE INDEX users_department_id_idx ON compliance.users USING btree (department_id);
CREATE INDEX users_org_id_idx ON compliance.users USING btree (org_id);
CREATE INDEX users_reporting_to_id_idx ON compliance.users USING btree (reporting_to_id);
CREATE INDEX documents_client_id_idx ON compliance.documents USING btree (client_id);
CREATE INDEX documents_expiry_date_idx ON compliance.documents USING btree (expiry_date);
CREATE INDEX documents_linked_entity_idx ON compliance.documents USING btree (linked_entity_type, linked_entity_id);
CREATE INDEX documents_org_latest_idx ON compliance.documents USING btree (org_id, is_latest_version);
CREATE INDEX documents_parent_document_idx ON compliance.documents USING btree (parent_document_id);
CREATE INDEX documents_uploaded_by_id_idx ON compliance.documents USING btree (uploaded_by_id);
CREATE INDEX idx_ct2_documents_item ON compliance.documents USING btree (compliance_item_id);
CREATE INDEX idx_documents_correspondent_id ON compliance.documents USING btree (correspondent_id);
CREATE INDEX idx_documents_disposal_date ON compliance.documents USING btree (disposal_date) WHERE (is_disposed = false);
CREATE INDEX idx_documents_fulltext_search ON compliance.documents USING gin (to_tsvector('english'::regconfig, ((COALESCE(name, ''::text) || ' '::text) || COALESCE((extracted_data ->> 'summary'::text), ''::text))));
CREATE INDEX idx_documents_notice_id ON compliance.documents USING btree (notice_id);
CREATE INDEX idx_documents_org_id ON compliance.documents USING btree (org_id);
CREATE INDEX idx_documents_source_object_id ON compliance.documents USING btree (source_object_id);
CREATE INDEX idx_projects_client_id ON compliance.projects USING btree (client_id);
CREATE INDEX idx_projects_lead_user_id ON compliance.projects USING btree (lead_user_id);
CREATE INDEX idx_projects_org_id ON compliance.projects USING btree (org_id);
CREATE INDEX idx_projects_parent_project_id ON compliance.projects USING btree (parent_project_id);
CREATE INDEX idx_projects_product_id ON compliance.projects USING btree (product_id);
CREATE INDEX projects_access_level_idx ON compliance.projects USING btree (org_id, access_level);
CREATE INDEX idx_pms_issues_assigned_by_id ON compliance.pms_issues USING btree (assigned_by_id);
CREATE INDEX idx_pms_issues_assignee_id ON compliance.pms_issues USING btree (assignee_id);
CREATE INDEX idx_pms_issues_client_id ON compliance.pms_issues USING btree (client_id);
CREATE INDEX idx_pms_issues_created_by_id ON compliance.pms_issues USING btree (created_by_id);
CREATE INDEX idx_pms_issues_estimate_point_id ON compliance.pms_issues USING btree (estimate_point_id);
CREATE INDEX idx_pms_issues_milestone_id ON compliance.pms_issues USING btree (milestone_id);
CREATE INDEX idx_pms_issues_org_id ON compliance.pms_issues USING btree (org_id);
CREATE INDEX idx_pms_issues_parent_issue_id ON compliance.pms_issues USING btree (parent_issue_id);
CREATE INDEX idx_pms_issues_project_id ON compliance.pms_issues USING btree (project_id);
CREATE INDEX idx_pms_issues_status_id ON compliance.pms_issues USING btree (status_id);
CREATE INDEX idx_pms_issues_type_id ON compliance.pms_issues USING btree (type_id);
CREATE INDEX idx_pms_time_entries_invoice_item_id ON compliance.pms_time_entries USING btree (invoice_item_id);
CREATE INDEX idx_pms_time_entries_issue_id ON compliance.pms_time_entries USING btree (issue_id);
CREATE INDEX idx_pms_time_entries_org_id ON compliance.pms_time_entries USING btree (org_id);
CREATE INDEX idx_pms_time_entries_unbilled ON compliance.pms_time_entries USING btree (org_id, issue_id, billable, invoice_item_id);
CREATE INDEX idx_pms_time_entries_user_id ON compliance.pms_time_entries USING btree (user_id);
CREATE INDEX pms_time_entries_approval_status_idx ON compliance.pms_time_entries USING btree (org_id, approval_status);
CREATE INDEX idx_pms_meetings_org_id ON compliance.pms_meetings USING btree (org_id);
CREATE INDEX idx_pms_meetings_project_id ON compliance.pms_meetings USING btree (project_id);
CREATE INDEX idx_construction_boqs_org_project ON compliance.construction_boqs USING btree (org_id, project_id);
CREATE INDEX construction_boq_line_items_boq_category_idx ON compliance.construction_boq_line_items USING btree (boq_id, category);
CREATE INDEX construction_boq_line_items_parent_line_item_id_idx ON compliance.construction_boq_line_items USING btree (parent_line_item_id);
CREATE INDEX idx_construction_boq_line_items_boq_id ON compliance.construction_boq_line_items USING btree (boq_id);
CREATE INDEX idx_construction_boq_line_items_org_id ON compliance.construction_boq_line_items USING btree (org_id);
CREATE INDEX idx_construction_work_progress_entries_boq_line_item_id ON compliance.construction_work_progress_entries USING btree (boq_line_item_id);
CREATE UNIQUE INDEX construction_labour_roster_org_employee_code_unique ON compliance.construction_labour_roster USING btree (org_id, employee_code) WHERE ((employee_code IS NOT NULL) AND (btrim(employee_code) <> ''::text));
CREATE UNIQUE INDEX construction_attendance_org_roster_date_unique ON compliance.construction_attendance USING btree (org_id, roster_id, attendance_date);
CREATE INDEX idx_construction_attendance_project_date ON compliance.construction_attendance USING btree (project_id, attendance_date DESC);
CREATE INDEX submissions_org_user_idx ON compliance.submissions USING btree (org_id, user_id);
CREATE INDEX idx_pipeline_tasks_depends_on ON compliance.pipeline_tasks USING btree (depends_on);
CREATE INDEX pipeline_tasks_org_project_idx ON compliance.pipeline_tasks USING btree (org_id, project_id);
CREATE INDEX pipeline_tasks_submission_idx ON compliance.pipeline_tasks USING btree (submission_id);
CREATE UNIQUE INDEX user_ai_links_one_live_per_user_project ON platform.user_ai_links USING btree (user_id, project_id) WHERE ((status = 'active'::text) AND (product = 'projexa'::text));
CREATE UNIQUE INDEX user_ai_links_one_live_veridian ON platform.user_ai_links USING btree (org_id, user_id) WHERE ((status = 'active'::text) AND (product = 'veridian'::text));
CREATE INDEX user_ai_links_token_idx ON platform.user_ai_links USING btree (token) WHERE (status = 'active'::text);
CREATE INDEX project_team_members_org_id_idx ON compliance.project_team_members USING btree (org_id);
CREATE INDEX project_team_members_project_id_idx ON compliance.project_team_members USING btree (project_id);
CREATE INDEX project_team_members_user_id_idx ON compliance.project_team_members USING btree (user_id);
CREATE INDEX idx_cost_visibility_config_org_id ON compliance.cost_visibility_config USING btree (org_id);
ALTER TABLE platform.user_ai_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.users FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.project_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boqs FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boq_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_boq_line_items FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_activities FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_work_progress_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_work_progress_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_issues FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_meetings FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_labour_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_labour_roster FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_attendance FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_time_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.pipeline_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.cost_visibility_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_preauth_insert_users ON compliance.users AS PERMISSIVE FOR INSERT TO app_runtime WITH CHECK ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_preauth_read_users ON compliance.users AS PERMISSIVE FOR SELECT TO app_runtime USING ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_preauth_update_users ON compliance.users AS PERMISSIVE FOR UPDATE TO app_runtime USING ((compliance.current_org_id() IS NULL)) WITH CHECK ((compliance.current_org_id() IS NULL));
CREATE POLICY app_runtime_tenant_isolation ON compliance.users AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_compliance_users ON compliance.users AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.documents AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_documents ON compliance.documents AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_org_scoped ON compliance.projects AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_projects ON compliance.projects AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.pms_issues AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_pms_issues ON compliance.pms_issues AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.pms_time_entries AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_pms_time_entries ON compliance.pms_time_entries AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.pms_meetings AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_pms_meetings ON compliance.pms_meetings AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_boqs AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_boqs ON compliance.construction_boqs AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_boq_line_items AS PERMISSIVE FOR ALL TO app_runtime USING ((EXISTS ( SELECT 1
   FROM compliance.construction_boqs b
  WHERE ((b.id = construction_boq_line_items.boq_id) AND (b.org_id = compliance.current_org_id())))));
CREATE POLICY service_role_bypass_construction_boq_line_items ON compliance.construction_boq_line_items AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_activities AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_activities ON compliance.construction_activities AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_work_progress_entries AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_work_progress_entries ON compliance.construction_work_progress_entries AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_labour_roster AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_labour_roster ON compliance.construction_labour_roster AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_attendance AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_attendance ON compliance.construction_attendance AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.submissions AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_submissions ON compliance.submissions AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.pipeline_tasks AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_pipeline_tasks ON compliance.pipeline_tasks AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON platform.user_ai_links AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
CREATE POLICY app_runtime_tenant_isolation ON compliance.project_team_members AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_project_team_members ON compliance.project_team_members AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.cost_visibility_config AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id())) WITH CHECK ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_cost_visibility_config ON compliance.cost_visibility_config AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT DELETE ON TABLE compliance.users TO app_runtime;
GRANT INSERT ON TABLE compliance.users TO app_runtime;
GRANT SELECT ON TABLE compliance.users TO app_runtime;
GRANT UPDATE ON TABLE compliance.users TO app_runtime;
GRANT DELETE ON TABLE compliance.users TO service_role;
GRANT INSERT ON TABLE compliance.users TO service_role;
GRANT SELECT ON TABLE compliance.users TO service_role;
GRANT UPDATE ON TABLE compliance.users TO service_role;
GRANT DELETE ON TABLE compliance.documents TO app_runtime;
GRANT INSERT ON TABLE compliance.documents TO app_runtime;
GRANT SELECT ON TABLE compliance.documents TO app_runtime;
GRANT UPDATE ON TABLE compliance.documents TO app_runtime;
GRANT DELETE ON TABLE compliance.documents TO service_role;
GRANT INSERT ON TABLE compliance.documents TO service_role;
GRANT SELECT ON TABLE compliance.documents TO service_role;
GRANT UPDATE ON TABLE compliance.documents TO service_role;
GRANT DELETE ON TABLE compliance.projects TO app_runtime;
GRANT INSERT ON TABLE compliance.projects TO app_runtime;
GRANT SELECT ON TABLE compliance.projects TO app_runtime;
GRANT UPDATE ON TABLE compliance.projects TO app_runtime;
GRANT DELETE ON TABLE compliance.projects TO service_role;
GRANT INSERT ON TABLE compliance.projects TO service_role;
GRANT SELECT ON TABLE compliance.projects TO service_role;
GRANT UPDATE ON TABLE compliance.projects TO service_role;
GRANT DELETE ON TABLE compliance.pms_issues TO app_runtime;
GRANT INSERT ON TABLE compliance.pms_issues TO app_runtime;
GRANT SELECT ON TABLE compliance.pms_issues TO app_runtime;
GRANT UPDATE ON TABLE compliance.pms_issues TO app_runtime;
GRANT DELETE ON TABLE compliance.pms_issues TO service_role;
GRANT INSERT ON TABLE compliance.pms_issues TO service_role;
GRANT SELECT ON TABLE compliance.pms_issues TO service_role;
GRANT UPDATE ON TABLE compliance.pms_issues TO service_role;
GRANT DELETE ON TABLE compliance.pms_time_entries TO app_runtime;
GRANT INSERT ON TABLE compliance.pms_time_entries TO app_runtime;
GRANT SELECT ON TABLE compliance.pms_time_entries TO app_runtime;
GRANT UPDATE ON TABLE compliance.pms_time_entries TO app_runtime;
GRANT DELETE ON TABLE compliance.pms_time_entries TO service_role;
GRANT INSERT ON TABLE compliance.pms_time_entries TO service_role;
GRANT SELECT ON TABLE compliance.pms_time_entries TO service_role;
GRANT UPDATE ON TABLE compliance.pms_time_entries TO service_role;
GRANT DELETE ON TABLE compliance.pms_meetings TO app_runtime;
GRANT INSERT ON TABLE compliance.pms_meetings TO app_runtime;
GRANT SELECT ON TABLE compliance.pms_meetings TO app_runtime;
GRANT UPDATE ON TABLE compliance.pms_meetings TO app_runtime;
GRANT DELETE ON TABLE compliance.pms_meetings TO service_role;
GRANT INSERT ON TABLE compliance.pms_meetings TO service_role;
GRANT SELECT ON TABLE compliance.pms_meetings TO service_role;
GRANT UPDATE ON TABLE compliance.pms_meetings TO service_role;
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
GRANT DELETE ON TABLE compliance.construction_activities TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_activities TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_activities TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_activities TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_activities TO service_role;
GRANT INSERT ON TABLE compliance.construction_activities TO service_role;
GRANT SELECT ON TABLE compliance.construction_activities TO service_role;
GRANT UPDATE ON TABLE compliance.construction_activities TO service_role;
GRANT DELETE ON TABLE compliance.construction_work_progress_entries TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_work_progress_entries TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_work_progress_entries TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_work_progress_entries TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_work_progress_entries TO service_role;
GRANT INSERT ON TABLE compliance.construction_work_progress_entries TO service_role;
GRANT SELECT ON TABLE compliance.construction_work_progress_entries TO service_role;
GRANT UPDATE ON TABLE compliance.construction_work_progress_entries TO service_role;
GRANT DELETE ON TABLE compliance.construction_labour_roster TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_labour_roster TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_labour_roster TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_labour_roster TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_labour_roster TO service_role;
GRANT INSERT ON TABLE compliance.construction_labour_roster TO service_role;
GRANT SELECT ON TABLE compliance.construction_labour_roster TO service_role;
GRANT UPDATE ON TABLE compliance.construction_labour_roster TO service_role;
GRANT DELETE ON TABLE compliance.construction_attendance TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_attendance TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_attendance TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_attendance TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_attendance TO service_role;
GRANT INSERT ON TABLE compliance.construction_attendance TO service_role;
GRANT SELECT ON TABLE compliance.construction_attendance TO service_role;
GRANT UPDATE ON TABLE compliance.construction_attendance TO service_role;
GRANT DELETE ON TABLE compliance.submissions TO app_runtime;
GRANT INSERT ON TABLE compliance.submissions TO app_runtime;
GRANT SELECT ON TABLE compliance.submissions TO app_runtime;
GRANT UPDATE ON TABLE compliance.submissions TO app_runtime;
GRANT DELETE ON TABLE compliance.submissions TO service_role;
GRANT INSERT ON TABLE compliance.submissions TO service_role;
GRANT SELECT ON TABLE compliance.submissions TO service_role;
GRANT UPDATE ON TABLE compliance.submissions TO service_role;
GRANT DELETE ON TABLE compliance.pipeline_tasks TO app_runtime;
GRANT INSERT ON TABLE compliance.pipeline_tasks TO app_runtime;
GRANT SELECT ON TABLE compliance.pipeline_tasks TO app_runtime;
GRANT UPDATE ON TABLE compliance.pipeline_tasks TO app_runtime;
GRANT DELETE ON TABLE compliance.pipeline_tasks TO service_role;
GRANT INSERT ON TABLE compliance.pipeline_tasks TO service_role;
GRANT SELECT ON TABLE compliance.pipeline_tasks TO service_role;
GRANT UPDATE ON TABLE compliance.pipeline_tasks TO service_role;
GRANT DELETE ON TABLE platform.user_ai_links TO app_runtime;
GRANT INSERT ON TABLE platform.user_ai_links TO app_runtime;
GRANT SELECT ON TABLE platform.user_ai_links TO app_runtime;
GRANT UPDATE ON TABLE platform.user_ai_links TO app_runtime;
GRANT DELETE ON TABLE platform.user_ai_links TO service_role;
GRANT INSERT ON TABLE platform.user_ai_links TO service_role;
GRANT SELECT ON TABLE platform.user_ai_links TO service_role;
GRANT UPDATE ON TABLE platform.user_ai_links TO service_role;
GRANT DELETE ON TABLE compliance.project_team_members TO app_runtime;
GRANT INSERT ON TABLE compliance.project_team_members TO app_runtime;
GRANT SELECT ON TABLE compliance.project_team_members TO app_runtime;
GRANT UPDATE ON TABLE compliance.project_team_members TO app_runtime;
GRANT DELETE ON TABLE compliance.project_team_members TO service_role;
GRANT INSERT ON TABLE compliance.project_team_members TO service_role;
GRANT SELECT ON TABLE compliance.project_team_members TO service_role;
GRANT UPDATE ON TABLE compliance.project_team_members TO service_role;
GRANT DELETE ON TABLE compliance.cost_visibility_config TO app_runtime;
GRANT INSERT ON TABLE compliance.cost_visibility_config TO app_runtime;
GRANT SELECT ON TABLE compliance.cost_visibility_config TO app_runtime;
GRANT UPDATE ON TABLE compliance.cost_visibility_config TO app_runtime;
GRANT DELETE ON TABLE compliance.cost_visibility_config TO service_role;
GRANT INSERT ON TABLE compliance.cost_visibility_config TO service_role;
GRANT SELECT ON TABLE compliance.cost_visibility_config TO service_role;
GRANT UPDATE ON TABLE compliance.cost_visibility_config TO service_role;
RESET check_function_bodies;
