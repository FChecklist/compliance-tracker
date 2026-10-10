-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-26T15:18:22Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables compliance.construction_rfis,compliance.construction_submittals,compliance.construction_punch_list_items,compliance.construction_change_orders,compliance.construction_site_diaries,compliance.construction_site_instructions,compliance.pms_milestones,compliance.construction_progress_claims,compliance.construction_interim_bills,compliance.construction_materials,compliance.construction_material_receipts,compliance.construction_material_issues,compliance.construction_kpi_definitions,compliance.construction_kpi_entries,compliance.construction_expense_entries,compliance.veri_meetings,compliance.pms_wiki_pages,compliance.interior_ffe_items,compliance.pms_schedule_baselines
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key pms_milestones_org_id_fkey on compliance.pms_milestones references compliance.organisations, not in the snapshot
-- left out: foreign key pms_milestones_project_id_fkey on compliance.pms_milestones references compliance.projects, not in the snapshot
-- left out: foreign key pms_wiki_pages_org_id_fkey on compliance.pms_wiki_pages references compliance.organisations, not in the snapshot
-- left out: foreign key pms_wiki_pages_project_id_fkey on compliance.pms_wiki_pages references compliance.projects, not in the snapshot
-- left out: foreign key pms_wiki_pages_updated_by_id_fkey on compliance.pms_wiki_pages references compliance.users, not in the snapshot
-- left out: foreign key veri_meetings_created_by_id_fkey on compliance.veri_meetings references compliance.users, not in the snapshot
-- left out: foreign key veri_meetings_org_id_fkey on compliance.veri_meetings references compliance.organisations, not in the snapshot
-- left out: foreign key veri_meetings_published_by_id_fkey on compliance.veri_meetings references compliance.users, not in the snapshot
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE TYPE compliance.construction_rfi_status AS ENUM ('open', 'answered', 'closed');
CREATE TYPE compliance.construction_ball_in_court AS ENUM ('contractor', 'architect', 'owner', 'consultant');
CREATE TYPE compliance.construction_submittal_type AS ENUM ('shop_drawing', 'product_data', 'sample', 'other');
CREATE TYPE compliance.construction_submittal_status AS ENUM ('pending', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected');
CREATE TYPE compliance.construction_punch_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE compliance.construction_punch_status AS ENUM ('open', 'ready_for_review', 'verified_closed');
CREATE TYPE compliance.construction_change_order_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected');
CREATE TYPE compliance.pms_milestone_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
CREATE TYPE compliance.construction_claim_status AS ENUM ('milestone_achieved', 'drafted', 'submitted', 'client_approved', 'invoiced', 'rejected');
CREATE TYPE compliance.construction_kpi_period AS ENUM ('monthly', 'quarterly', 'milestone');
CREATE TYPE compliance.construction_kpi_approval_status AS ENUM ('draft', 'submitted', 'approved');
CREATE TYPE compliance.construction_expense_head AS ENUM ('material', 'labour', 'transport', 'subcontractor', 'equipment', 'misc');
CREATE TYPE compliance.interior_ffe_category AS ENUM ('furniture', 'fixture', 'equipment', 'finish', 'textile', 'lighting', 'other');
CREATE TYPE compliance.interior_ffe_status AS ENUM ('specified', 'ordered', 'received', 'installed');
CREATE TABLE compliance.construction_rfis (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  subject text NOT NULL,
  question text NOT NULL,
  status compliance.construction_rfi_status DEFAULT 'open'::compliance.construction_rfi_status NOT NULL,
  ball_in_court compliance.construction_ball_in_court DEFAULT 'architect'::compliance.construction_ball_in_court NOT NULL,
  raised_by_id text NOT NULL,
  assigned_to_id text,
  due_date date,
  answer text,
  answered_by_id text,
  answered_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_submittals (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  spec_section text,
  type compliance.construction_submittal_type DEFAULT 'shop_drawing'::compliance.construction_submittal_type NOT NULL,
  status compliance.construction_submittal_status DEFAULT 'pending'::compliance.construction_submittal_status NOT NULL,
  submitted_by_id text NOT NULL,
  due_date date,
  reviewed_by_id text,
  reviewed_at timestamp with time zone,
  review_comments text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_punch_list_items (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  description text NOT NULL,
  location text,
  trade text,
  priority compliance.construction_punch_priority DEFAULT 'medium'::compliance.construction_punch_priority NOT NULL,
  status compliance.construction_punch_status DEFAULT 'open'::compliance.construction_punch_status NOT NULL,
  assigned_to_id text,
  due_date date,
  verified_by_id text,
  verified_at timestamp with time zone,
  created_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_change_orders (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  description text,
  reason text,
  cost_impact numeric DEFAULT 0 NOT NULL,
  schedule_impact_days integer DEFAULT 0 NOT NULL,
  status compliance.construction_change_order_status DEFAULT 'draft'::compliance.construction_change_order_status NOT NULL,
  requested_by_id text NOT NULL,
  approved_by_id text,
  approved_at timestamp with time zone,
  esignature_request_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  trade text,
  boq_revision_id text
);
CREATE TABLE compliance.construction_site_diaries (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  diary_date date NOT NULL,
  weather text,
  work_done text,
  visitors text,
  issues text,
  instructions text,
  material_received text,
  labour_count integer,
  remarks text,
  recorded_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_site_instructions (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  si_number integer NOT NULL,
  issue_date date NOT NULL,
  issued_by text NOT NULL,
  to_contractor text NOT NULL,
  description text NOT NULL,
  drawing_ref text,
  cost_impact boolean DEFAULT false NOT NULL,
  time_impact boolean DEFAULT false NOT NULL,
  boq_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.pms_milestones (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  description text,
  status compliance.pms_milestone_status DEFAULT 'planned'::compliance.pms_milestone_status NOT NULL,
  target_date date,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_progress_claims (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  boq_id text NOT NULL,
  customer_id text NOT NULL,
  milestone_description text NOT NULL,
  scheduled_date date NOT NULL,
  retention_percent numeric DEFAULT 0 NOT NULL,
  status compliance.construction_claim_status DEFAULT 'milestone_achieved'::compliance.construction_claim_status NOT NULL,
  drafted_at timestamp with time zone,
  submitted_at timestamp with time zone,
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  rejection_reason text,
  invoiced_at timestamp with time zone,
  interim_bill_id text,
  created_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_interim_bills (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  boq_id text NOT NULL,
  bill_number integer NOT NULL,
  bill_date date NOT NULL,
  retention_percent numeric DEFAULT 0 NOT NULL,
  gross_amount numeric DEFAULT 0 NOT NULL,
  retention_amount numeric DEFAULT 0 NOT NULL,
  net_payable numeric DEFAULT 0 NOT NULL,
  sales_invoice_id text,
  created_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  retention_released_amount numeric,
  retention_released_at timestamp without time zone,
  retention_released_by_id text
);
CREATE TABLE compliance.construction_materials (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  spec text,
  unit text NOT NULL,
  unit_cost numeric DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reorder_level numeric
);
CREATE TABLE compliance.construction_material_receipts (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL,
  received_date date NOT NULL,
  quantity numeric NOT NULL,
  unit_cost numeric,
  vendor_id text,
  notes text,
  created_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  voided_at timestamp with time zone,
  void_reason text,
  voided_by_id text,
  reference text
);
CREATE TABLE compliance.construction_material_issues (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL,
  issued_date date NOT NULL,
  quantity numeric NOT NULL,
  boq_line_item_id text,
  issued_to text,
  note text,
  created_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_kpi_definitions (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text,
  metric_name text NOT NULL,
  target_value numeric,
  unit text,
  period compliance.construction_kpi_period DEFAULT 'monthly'::compliance.construction_kpi_period NOT NULL,
  owner_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_kpi_entries (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  kpi_definition_id text NOT NULL,
  period text NOT NULL,
  actual_value numeric NOT NULL,
  filled_by_id text NOT NULL,
  approval_status compliance.construction_kpi_approval_status DEFAULT 'draft'::compliance.construction_kpi_approval_status NOT NULL,
  approved_by_id text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.construction_expense_entries (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  expense_head compliance.construction_expense_head NOT NULL,
  description text,
  amount numeric NOT NULL,
  expense_date date NOT NULL,
  linked_entity_type text,
  linked_entity_id text,
  recorded_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_rework boolean DEFAULT false NOT NULL,
  journal_entry_id text
);
CREATE TABLE compliance.veri_meetings (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  context_entity_type text,
  context_entity_id text,
  title text NOT NULL,
  meeting_type text DEFAULT 'team'::text NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
  agenda jsonb DEFAULT '[]'::jsonb NOT NULL,
  minutes text,
  minutes_history jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_by_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  system_id text,
  status text DEFAULT 'draft'::text NOT NULL,
  published_at timestamp with time zone,
  published_by_id text,
  ai_summary text,
  ai_key_decisions jsonb DEFAULT '[]'::jsonb NOT NULL,
  ai_suggested_action_items jsonb DEFAULT '[]'::jsonb NOT NULL,
  ai_generated_at timestamp with time zone
);
CREATE TABLE compliance.pms_wiki_pages (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  parent_page_id text,
  slug text NOT NULL,
  title text NOT NULL,
  content text,
  version integer DEFAULT 1 NOT NULL,
  updated_by_id text,
  is_archived boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE compliance.interior_ffe_items (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  room_or_area text,
  category compliance.interior_ffe_category DEFAULT 'furniture'::compliance.interior_ffe_category NOT NULL,
  item_name text NOT NULL,
  description text,
  vendor_id text,
  sku text,
  quantity integer DEFAULT 1 NOT NULL,
  unit_cost numeric DEFAULT 0 NOT NULL,
  unit_price numeric DEFAULT 0 NOT NULL,
  lead_time_days integer,
  status compliance.interior_ffe_status DEFAULT 'specified'::compliance.interior_ffe_status NOT NULL,
  document_id text,
  created_by_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  width_cm numeric,
  depth_cm numeric,
  height_cm numeric
);
CREATE TABLE compliance.pms_schedule_baselines (
  id text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  captured_by_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE compliance.pms_milestones ADD CONSTRAINT pms_milestones_pkey PRIMARY KEY (id);
ALTER TABLE compliance.pms_wiki_pages ADD CONSTRAINT pms_wiki_pages_pkey PRIMARY KEY (id);
ALTER TABLE compliance.veri_meetings ADD CONSTRAINT veri_meetings_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_site_diaries ADD CONSTRAINT construction_site_diaries_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_kpi_definitions ADD CONSTRAINT construction_kpi_definitions_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_kpi_entries ADD CONSTRAINT construction_kpi_entries_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_expense_entries ADD CONSTRAINT construction_expense_entries_pkey PRIMARY KEY (id);
ALTER TABLE compliance.pms_schedule_baselines ADD CONSTRAINT pms_schedule_baselines_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_rfis ADD CONSTRAINT construction_rfis_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_submittals ADD CONSTRAINT construction_submittals_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_punch_list_items ADD CONSTRAINT construction_punch_list_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_change_orders ADD CONSTRAINT construction_change_orders_pkey PRIMARY KEY (id);
ALTER TABLE compliance.interior_ffe_items ADD CONSTRAINT interior_ffe_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_interim_bills ADD CONSTRAINT construction_interim_bills_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_progress_claims ADD CONSTRAINT construction_progress_claims_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_materials ADD CONSTRAINT construction_materials_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_material_receipts ADD CONSTRAINT construction_material_receipts_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_site_instructions ADD CONSTRAINT construction_site_instructions_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_material_issues ADD CONSTRAINT construction_material_issues_pkey PRIMARY KEY (id);
ALTER TABLE compliance.pms_wiki_pages ADD CONSTRAINT pms_wiki_pages_project_id_slug_key UNIQUE (project_id, slug);
ALTER TABLE compliance.veri_meetings ADD CONSTRAINT veri_meetings_system_id_key UNIQUE (system_id);
ALTER TABLE compliance.construction_site_diaries ADD CONSTRAINT construction_site_diaries_project_date_unique UNIQUE (project_id, diary_date);
ALTER TABLE compliance.pms_wiki_pages ADD CONSTRAINT pms_wiki_pages_parent_page_id_fkey FOREIGN KEY (parent_page_id) REFERENCES compliance.pms_wiki_pages(id);
ALTER TABLE compliance.construction_material_receipts ADD CONSTRAINT construction_material_receipts_material_id_fkey FOREIGN KEY (material_id) REFERENCES compliance.construction_materials(id) ON DELETE RESTRICT;
ALTER TABLE compliance.construction_material_issues ADD CONSTRAINT construction_material_issues_material_id_fkey FOREIGN KEY (material_id) REFERENCES compliance.construction_materials(id) ON DELETE RESTRICT;
CREATE INDEX idx_pms_milestones_org_id ON compliance.pms_milestones USING btree (org_id);
CREATE INDEX idx_pms_milestones_project_id ON compliance.pms_milestones USING btree (project_id);
CREATE INDEX idx_pms_wiki_pages_org_id ON compliance.pms_wiki_pages USING btree (org_id);
CREATE INDEX idx_pms_wiki_pages_parent_page_id ON compliance.pms_wiki_pages USING btree (parent_page_id);
CREATE INDEX idx_pms_wiki_pages_project_id ON compliance.pms_wiki_pages USING btree (project_id);
CREATE INDEX idx_pms_wiki_pages_updated_by_id ON compliance.pms_wiki_pages USING btree (updated_by_id);
CREATE INDEX idx_veri_meetings_context ON compliance.veri_meetings USING btree (context_entity_type, context_entity_id);
CREATE INDEX idx_veri_meetings_created_by_id ON compliance.veri_meetings USING btree (created_by_id);
CREATE INDEX idx_veri_meetings_org_id ON compliance.veri_meetings USING btree (org_id);
CREATE INDEX idx_veri_meetings_published_by_id ON compliance.veri_meetings USING btree (published_by_id);
CREATE INDEX idx_veri_meetings_status ON compliance.veri_meetings USING btree (status);
CREATE INDEX idx_pms_schedule_baselines_org_project ON compliance.pms_schedule_baselines USING btree (org_id, project_id);
CREATE INDEX idx_construction_rfis_org_project ON compliance.construction_rfis USING btree (org_id, project_id);
CREATE INDEX idx_construction_submittals_org_project ON compliance.construction_submittals USING btree (org_id, project_id);
CREATE INDEX idx_construction_punch_list_items_org_project ON compliance.construction_punch_list_items USING btree (org_id, project_id);
CREATE INDEX idx_construction_change_orders_org_project ON compliance.construction_change_orders USING btree (org_id, project_id);
CREATE INDEX idx_interior_ffe_items_org_project ON compliance.interior_ffe_items USING btree (org_id, project_id);
CREATE INDEX construction_interim_bills_boq_id_idx ON compliance.construction_interim_bills USING btree (boq_id);
CREATE INDEX construction_interim_bills_project_id_idx ON compliance.construction_interim_bills USING btree (project_id);
CREATE INDEX construction_progress_claims_boq_id_idx ON compliance.construction_progress_claims USING btree (boq_id);
CREATE INDEX construction_progress_claims_org_status_idx ON compliance.construction_progress_claims USING btree (org_id, status, scheduled_date);
CREATE INDEX construction_progress_claims_project_id_idx ON compliance.construction_progress_claims USING btree (project_id);
CREATE INDEX construction_materials_project_idx ON compliance.construction_materials USING btree (project_id);
CREATE INDEX construction_material_receipts_live_idx ON compliance.construction_material_receipts USING btree (org_id, project_id, received_date) WHERE (voided_at IS NULL);
CREATE INDEX construction_material_receipts_material_idx ON compliance.construction_material_receipts USING btree (material_id);
CREATE INDEX construction_material_receipts_project_date_idx ON compliance.construction_material_receipts USING btree (org_id, project_id, received_date);
CREATE INDEX construction_material_issues_boq_line_idx ON compliance.construction_material_issues USING btree (boq_line_item_id);
CREATE INDEX construction_material_issues_material_idx ON compliance.construction_material_issues USING btree (material_id);
CREATE INDEX construction_material_issues_project_date_idx ON compliance.construction_material_issues USING btree (org_id, project_id, issued_date);
ALTER TABLE compliance.construction_rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_rfis FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_submittals FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_punch_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_punch_list_items FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_change_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_site_diaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_site_diaries FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_site_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_milestones FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_progress_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_interim_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_material_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_material_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_kpi_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_kpi_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_kpi_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_expense_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_expense_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.veri_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.veri_meetings FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_wiki_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_wiki_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_ffe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_ffe_items FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_schedule_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_org_scoped ON compliance.pms_milestones AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_pms_milestones ON compliance.pms_milestones AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.pms_wiki_pages AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_pms_wiki_pages ON compliance.pms_wiki_pages AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.veri_meetings AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_veri_meetings ON compliance.veri_meetings AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_site_diaries AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_site_diaries ON compliance.construction_site_diaries AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_kpi_definitions AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_kpi_definitions ON compliance.construction_kpi_definitions AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_kpi_entries AS PERMISSIVE FOR ALL TO app_runtime USING ((EXISTS ( SELECT 1
   FROM compliance.construction_kpi_definitions d
  WHERE ((d.id = construction_kpi_entries.kpi_definition_id) AND (d.org_id = compliance.current_org_id())))));
CREATE POLICY service_role_bypass_construction_kpi_entries ON compliance.construction_kpi_entries AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_expense_entries AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_expense_entries ON compliance.construction_expense_entries AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_org_scoped ON compliance.pms_schedule_baselines AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_rfis AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_rfis ON compliance.construction_rfis AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_submittals AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_submittals ON compliance.construction_submittals AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_punch_list_items AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_punch_list_items ON compliance.construction_punch_list_items AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_change_orders AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_change_orders ON compliance.construction_change_orders AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_ffe_items AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_interior_ffe_items ON compliance.interior_ffe_items AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_interim_bills AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_interim_bills ON compliance.construction_interim_bills AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_progress_claims AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_progress_claims ON compliance.construction_progress_claims AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_materials AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_materials ON compliance.construction_materials AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_material_receipts AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_material_receipts ON compliance.construction_material_receipts AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_site_instructions AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_site_instructions ON compliance.construction_site_instructions AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_material_issues AS PERMISSIVE FOR ALL TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_construction_material_issues ON compliance.construction_material_issues AS PERMISSIVE FOR ALL TO service_role USING (true);
GRANT DELETE ON TABLE compliance.pms_milestones TO app_runtime;
GRANT INSERT ON TABLE compliance.pms_milestones TO app_runtime;
GRANT SELECT ON TABLE compliance.pms_milestones TO app_runtime;
GRANT UPDATE ON TABLE compliance.pms_milestones TO app_runtime;
GRANT DELETE ON TABLE compliance.pms_milestones TO service_role;
GRANT INSERT ON TABLE compliance.pms_milestones TO service_role;
GRANT SELECT ON TABLE compliance.pms_milestones TO service_role;
GRANT UPDATE ON TABLE compliance.pms_milestones TO service_role;
GRANT DELETE ON TABLE compliance.pms_wiki_pages TO app_runtime;
GRANT INSERT ON TABLE compliance.pms_wiki_pages TO app_runtime;
GRANT SELECT ON TABLE compliance.pms_wiki_pages TO app_runtime;
GRANT UPDATE ON TABLE compliance.pms_wiki_pages TO app_runtime;
GRANT DELETE ON TABLE compliance.pms_wiki_pages TO service_role;
GRANT INSERT ON TABLE compliance.pms_wiki_pages TO service_role;
GRANT SELECT ON TABLE compliance.pms_wiki_pages TO service_role;
GRANT UPDATE ON TABLE compliance.pms_wiki_pages TO service_role;
GRANT DELETE ON TABLE compliance.veri_meetings TO app_runtime;
GRANT INSERT ON TABLE compliance.veri_meetings TO app_runtime;
GRANT SELECT ON TABLE compliance.veri_meetings TO app_runtime;
GRANT UPDATE ON TABLE compliance.veri_meetings TO app_runtime;
GRANT DELETE ON TABLE compliance.veri_meetings TO service_role;
GRANT INSERT ON TABLE compliance.veri_meetings TO service_role;
GRANT SELECT ON TABLE compliance.veri_meetings TO service_role;
GRANT UPDATE ON TABLE compliance.veri_meetings TO service_role;
GRANT DELETE ON TABLE compliance.construction_site_diaries TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_site_diaries TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_site_diaries TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_site_diaries TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_site_diaries TO service_role;
GRANT INSERT ON TABLE compliance.construction_site_diaries TO service_role;
GRANT SELECT ON TABLE compliance.construction_site_diaries TO service_role;
GRANT UPDATE ON TABLE compliance.construction_site_diaries TO service_role;
GRANT DELETE ON TABLE compliance.construction_kpi_definitions TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_kpi_definitions TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_kpi_definitions TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_kpi_definitions TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_kpi_definitions TO service_role;
GRANT INSERT ON TABLE compliance.construction_kpi_definitions TO service_role;
GRANT SELECT ON TABLE compliance.construction_kpi_definitions TO service_role;
GRANT UPDATE ON TABLE compliance.construction_kpi_definitions TO service_role;
GRANT DELETE ON TABLE compliance.construction_kpi_entries TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_kpi_entries TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_kpi_entries TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_kpi_entries TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_kpi_entries TO service_role;
GRANT INSERT ON TABLE compliance.construction_kpi_entries TO service_role;
GRANT SELECT ON TABLE compliance.construction_kpi_entries TO service_role;
GRANT UPDATE ON TABLE compliance.construction_kpi_entries TO service_role;
GRANT DELETE ON TABLE compliance.construction_expense_entries TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_expense_entries TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_expense_entries TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_expense_entries TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_expense_entries TO service_role;
GRANT INSERT ON TABLE compliance.construction_expense_entries TO service_role;
GRANT SELECT ON TABLE compliance.construction_expense_entries TO service_role;
GRANT UPDATE ON TABLE compliance.construction_expense_entries TO service_role;
GRANT DELETE ON TABLE compliance.pms_schedule_baselines TO app_runtime;
GRANT INSERT ON TABLE compliance.pms_schedule_baselines TO app_runtime;
GRANT SELECT ON TABLE compliance.pms_schedule_baselines TO app_runtime;
GRANT UPDATE ON TABLE compliance.pms_schedule_baselines TO app_runtime;
GRANT DELETE ON TABLE compliance.pms_schedule_baselines TO service_role;
GRANT INSERT ON TABLE compliance.pms_schedule_baselines TO service_role;
GRANT SELECT ON TABLE compliance.pms_schedule_baselines TO service_role;
GRANT UPDATE ON TABLE compliance.pms_schedule_baselines TO service_role;
GRANT DELETE ON TABLE compliance.construction_rfis TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_rfis TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_rfis TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_rfis TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_rfis TO service_role;
GRANT INSERT ON TABLE compliance.construction_rfis TO service_role;
GRANT SELECT ON TABLE compliance.construction_rfis TO service_role;
GRANT UPDATE ON TABLE compliance.construction_rfis TO service_role;
GRANT DELETE ON TABLE compliance.construction_submittals TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_submittals TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_submittals TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_submittals TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_submittals TO service_role;
GRANT INSERT ON TABLE compliance.construction_submittals TO service_role;
GRANT SELECT ON TABLE compliance.construction_submittals TO service_role;
GRANT UPDATE ON TABLE compliance.construction_submittals TO service_role;
GRANT DELETE ON TABLE compliance.construction_punch_list_items TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_punch_list_items TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_punch_list_items TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_punch_list_items TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_punch_list_items TO service_role;
GRANT INSERT ON TABLE compliance.construction_punch_list_items TO service_role;
GRANT SELECT ON TABLE compliance.construction_punch_list_items TO service_role;
GRANT UPDATE ON TABLE compliance.construction_punch_list_items TO service_role;
GRANT DELETE ON TABLE compliance.construction_change_orders TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_change_orders TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_change_orders TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_change_orders TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_change_orders TO service_role;
GRANT INSERT ON TABLE compliance.construction_change_orders TO service_role;
GRANT SELECT ON TABLE compliance.construction_change_orders TO service_role;
GRANT UPDATE ON TABLE compliance.construction_change_orders TO service_role;
GRANT DELETE ON TABLE compliance.interior_ffe_items TO app_runtime;
GRANT INSERT ON TABLE compliance.interior_ffe_items TO app_runtime;
GRANT SELECT ON TABLE compliance.interior_ffe_items TO app_runtime;
GRANT UPDATE ON TABLE compliance.interior_ffe_items TO app_runtime;
GRANT DELETE ON TABLE compliance.interior_ffe_items TO service_role;
GRANT INSERT ON TABLE compliance.interior_ffe_items TO service_role;
GRANT SELECT ON TABLE compliance.interior_ffe_items TO service_role;
GRANT UPDATE ON TABLE compliance.interior_ffe_items TO service_role;
GRANT DELETE ON TABLE compliance.construction_interim_bills TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_interim_bills TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_interim_bills TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_interim_bills TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_interim_bills TO service_role;
GRANT INSERT ON TABLE compliance.construction_interim_bills TO service_role;
GRANT SELECT ON TABLE compliance.construction_interim_bills TO service_role;
GRANT UPDATE ON TABLE compliance.construction_interim_bills TO service_role;
GRANT DELETE ON TABLE compliance.construction_progress_claims TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_progress_claims TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_progress_claims TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_progress_claims TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_progress_claims TO service_role;
GRANT INSERT ON TABLE compliance.construction_progress_claims TO service_role;
GRANT SELECT ON TABLE compliance.construction_progress_claims TO service_role;
GRANT UPDATE ON TABLE compliance.construction_progress_claims TO service_role;
GRANT DELETE ON TABLE compliance.construction_materials TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_materials TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_materials TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_materials TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_materials TO service_role;
GRANT INSERT ON TABLE compliance.construction_materials TO service_role;
GRANT SELECT ON TABLE compliance.construction_materials TO service_role;
GRANT UPDATE ON TABLE compliance.construction_materials TO service_role;
GRANT DELETE ON TABLE compliance.construction_material_receipts TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_material_receipts TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_material_receipts TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_material_receipts TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_material_receipts TO service_role;
GRANT INSERT ON TABLE compliance.construction_material_receipts TO service_role;
GRANT SELECT ON TABLE compliance.construction_material_receipts TO service_role;
GRANT UPDATE ON TABLE compliance.construction_material_receipts TO service_role;
GRANT DELETE ON TABLE compliance.construction_site_instructions TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_site_instructions TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_site_instructions TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_site_instructions TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_site_instructions TO service_role;
GRANT INSERT ON TABLE compliance.construction_site_instructions TO service_role;
GRANT SELECT ON TABLE compliance.construction_site_instructions TO service_role;
GRANT UPDATE ON TABLE compliance.construction_site_instructions TO service_role;
GRANT DELETE ON TABLE compliance.construction_material_issues TO app_runtime;
GRANT INSERT ON TABLE compliance.construction_material_issues TO app_runtime;
GRANT SELECT ON TABLE compliance.construction_material_issues TO app_runtime;
GRANT UPDATE ON TABLE compliance.construction_material_issues TO app_runtime;
GRANT DELETE ON TABLE compliance.construction_material_issues TO service_role;
GRANT INSERT ON TABLE compliance.construction_material_issues TO service_role;
GRANT SELECT ON TABLE compliance.construction_material_issues TO service_role;
GRANT UPDATE ON TABLE compliance.construction_material_issues TO service_role;
RESET check_function_bodies;
