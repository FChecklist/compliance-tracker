-- Live schema snapshot for src/lib/services/construction-exceptions-service.test.ts's
-- "real Postgres" block (Sumeet EXC-ITEM-01..28). Loaded into PGlite (real Postgres as
-- WASM) so the detectors' real drizzle WHERE clauses run against real tables -- the gap
-- ai-os/projexa-build-001/U22_REQUIREMENT_CHECKS.md finding 1 recorded: the older
-- fake-db tests return every configured row whatever `where` they are given, so removing
-- the work_dispute filter (#11) or flipping isNotNull(parentBoqId) (#13) left them green.
--
-- PROVENANCE: generated 2026-09-30 from the live Supabase project pcrjmlpuqsbocqfwoxod's
-- own pg_catalog (format_type / pg_get_expr / pg_get_constraintdef over the 17 tables
-- below), not hand-written -- column names, types, NOT NULL, defaults, enum labels,
-- PK/UNIQUE/CHECK constraints are the live ones, verbatim.
--
-- DELIBERATELY OMITTED (and why): foreign keys whose target table is not in this set
-- (organisations, products, users, clients, erp_suppliers, erp_currencies, ...) -- the
-- detectors never read those tables, and adding them would only force unrelated fixture
-- rows; the four FKs BETWEEN tables in this set are kept. RLS policies and indexes are
-- also omitted: every detector filters org_id/project_id explicitly in its own WHERE
-- clause, which is exactly what this snapshot exists to test (RLS is a second, separate
-- layer the live app_runtime role adds on top).
--
-- Regenerate (read-only query, same one used to build this file) if a detector starts
-- reading a new column:
--   see the "construction-exceptions snapshot" query in this file's commit message.

CREATE SCHEMA IF NOT EXISTS compliance;

CREATE TYPE compliance.construction_boq_status AS ENUM ('draft', 'submitted', 'approved', 'superseded');
CREATE TYPE compliance.construction_change_order_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected');
CREATE TYPE compliance.construction_complaint_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE compliance.construction_dispute_status AS ENUM ('open', 'resolved');
CREATE TYPE compliance.construction_punch_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE compliance.construction_punch_status AS ENUM ('open', 'ready_for_review', 'verified_closed');
CREATE TYPE compliance.erp_invoice_status AS ENUM ('draft', 'submitted', 'partially_paid', 'paid', 'overdue', 'cancelled');
CREATE TYPE compliance.pms_project_access AS ENUM ('private', 'public');
CREATE TYPE compliance.pms_project_status AS ENUM ('planning', 'active', 'paused', 'completed', 'cancelled');

CREATE TABLE compliance.construction_boq_line_items (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  boq_id text NOT NULL,
  activity_id text,
  item_code text,
  description text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  material_cost numeric,
  labour_cost numeric,
  equipment_cost numeric,
  overhead_percent numeric,
  profit_percent numeric,
  parent_line_item_id text,
  breakdown_percentage numeric,
  org_id text NOT NULL,
  budget_percentage numeric NOT NULL DEFAULT '25'::numeric,
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
CREATE TABLE compliance.construction_boqs (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  parent_boq_id text,
  title text NOT NULL,
  status compliance.construction_boq_status NOT NULL DEFAULT 'draft'::compliance.construction_boq_status,
  created_by_id text NOT NULL,
  approved_by_id text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  contract_value_override numeric,
  override_actor_id text,
  override_at timestamp without time zone,
  override_reason text,
  evidence_artefact_ref text,
  customer_approved_by_id text,
  customer_approved_at timestamp without time zone,
  customer_esignature_request_id text
);
CREATE TABLE compliance.construction_change_orders (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  description text,
  reason text,
  cost_impact numeric NOT NULL DEFAULT 0,
  schedule_impact_days integer NOT NULL DEFAULT 0,
  status compliance.construction_change_order_status NOT NULL DEFAULT 'draft'::compliance.construction_change_order_status,
  requested_by_id text NOT NULL,
  approved_by_id text,
  approved_at timestamp with time zone,
  esignature_request_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  trade text,
  boq_revision_id text
);
CREATE TABLE compliance.construction_customer_complaints (
  id text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  customer_id text,
  category text NOT NULL DEFAULT 'general'::text,
  description text NOT NULL,
  severity compliance.construction_complaint_severity NOT NULL DEFAULT 'medium'::compliance.construction_complaint_severity,
  status compliance.construction_dispute_status NOT NULL DEFAULT 'open'::compliance.construction_dispute_status,
  resolution_note text,
  raised_by_id text NOT NULL,
  raised_at timestamp without time zone NOT NULL DEFAULT now(),
  resolved_at timestamp without time zone
);
CREATE TABLE compliance.construction_interim_bill_line_items (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  interim_bill_id text NOT NULL,
  boq_line_item_id text NOT NULL,
  cumulative_percent_complete integer NOT NULL DEFAULT 0,
  cumulative_amount numeric NOT NULL DEFAULT 0,
  previous_billed_amount numeric NOT NULL DEFAULT 0,
  current_bill_amount numeric NOT NULL DEFAULT 0
);
CREATE TABLE compliance.construction_interim_bills (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  boq_id text NOT NULL,
  bill_number integer NOT NULL,
  bill_date date NOT NULL,
  retention_percent numeric NOT NULL DEFAULT 0,
  gross_amount numeric NOT NULL DEFAULT 0,
  retention_amount numeric NOT NULL DEFAULT 0,
  net_payable numeric NOT NULL DEFAULT 0,
  sales_invoice_id text,
  created_by_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  retention_released_amount numeric,
  retention_released_at timestamp without time zone,
  retention_released_by_id text
);
CREATE TABLE compliance.construction_labour_roster (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  trade text,
  skill_level text,
  vendor_id text,
  daily_rate numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  employee_code text,
  employee_id text
);
CREATE TABLE compliance.construction_material_issues (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL,
  issued_date date NOT NULL,
  quantity numeric NOT NULL,
  boq_line_item_id text,
  issued_to text,
  note text,
  created_by_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE compliance.construction_materials (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  spec text,
  unit text NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  reorder_level numeric
);
CREATE TABLE compliance.construction_punch_list_items (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  description text NOT NULL,
  location text,
  trade text,
  priority compliance.construction_punch_priority NOT NULL DEFAULT 'medium'::compliance.construction_punch_priority,
  status compliance.construction_punch_status NOT NULL DEFAULT 'open'::compliance.construction_punch_status,
  assigned_to_id text,
  due_date date,
  verified_by_id text,
  verified_at timestamp with time zone,
  created_by_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE compliance.construction_site_diaries (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
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
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE compliance.construction_vendor_disputes (
  id text NOT NULL,
  org_id text NOT NULL,
  project_id text NOT NULL,
  vendor_id text,
  boq_line_item_id text,
  description text NOT NULL,
  amount_disputed numeric,
  status compliance.construction_dispute_status NOT NULL DEFAULT 'open'::compliance.construction_dispute_status,
  resolution_note text,
  raised_by_id text NOT NULL,
  raised_at timestamp without time zone NOT NULL DEFAULT now(),
  resolved_at timestamp without time zone
);
CREATE TABLE compliance.construction_work_progress_entries (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  activity_id text NOT NULL,
  entry_date date NOT NULL,
  quantity_done numeric NOT NULL DEFAULT 0,
  percent_complete numeric NOT NULL DEFAULT 0,
  remarks text,
  recorded_by_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  boq_line_item_id text,
  entry_basis text NOT NULL DEFAULT 'DELTA'::text,
  drawing_document_id text,
  drawing_confirmed_by_id text,
  drawing_confirmed_at timestamp without time zone
);
CREATE TABLE compliance.documents (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size integer,
  compliance_item_id text,
  uploaded_by_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  client_id text,
  notice_id text,
  extracted_data jsonb,
  org_id text NOT NULL,
  category text,
  expiry_date timestamp with time zone,
  linked_entity_type text,
  linked_entity_id text,
  parent_document_id text,
  version_number integer NOT NULL DEFAULT 1,
  is_latest_version boolean NOT NULL DEFAULT true,
  retention_period_days integer,
  disposal_date date,
  legal_hold boolean NOT NULL DEFAULT false,
  is_disposed boolean NOT NULL DEFAULT false,
  disposed_at timestamp with time zone,
  disposed_by_id text,
  metadata jsonb,
  correspondent_id text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_classified boolean NOT NULL DEFAULT false,
  source_object_id text
);
CREATE TABLE compliance.erp_purchase_invoice_items (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  invoice_id text NOT NULL,
  item_id text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  tax_template_id text,
  hsn_sac_code text,
  purchase_order_item_id text,
  boq_line_item_id text
);
CREATE TABLE compliance.erp_purchase_invoices (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  supplier_id text NOT NULL,
  invoice_number integer NOT NULL,
  posting_date date NOT NULL,
  due_date date,
  currency_id text,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  outstanding_amount numeric NOT NULL DEFAULT 0,
  status compliance.erp_invoice_status NOT NULL DEFAULT 'draft'::compliance.erp_invoice_status,
  journal_entry_id text,
  purchase_order_id text,
  created_by_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  exchange_rate numeric NOT NULL DEFAULT 1,
  company_id text,
  tds_amount numeric NOT NULL DEFAULT 0,
  retention_percent numeric NOT NULL DEFAULT 0,
  retention_amount numeric NOT NULL DEFAULT 0,
  retention_released_amount numeric NOT NULL DEFAULT 0
);
CREATE TABLE compliance.projects (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  product_id text NOT NULL,
  org_id text NOT NULL,
  client_id text,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  issue_prefix text,
  issue_sequence integer NOT NULL DEFAULT 0,
  lead_user_id text,
  start_date date,
  target_date date,
  health_status text,
  parent_project_id text,
  project_value numeric,
  status compliance.pms_project_status NOT NULL DEFAULT 'active'::compliance.pms_project_status,
  access_level compliance.pms_project_access NOT NULL DEFAULT 'public'::compliance.pms_project_access,
  rollup_percentage integer NOT NULL DEFAULT 0,
  custom_tabs jsonb NOT NULL DEFAULT '[]'::jsonb,
  vat_rate_percent numeric NOT NULL DEFAULT 5,
  retention_percent numeric NOT NULL DEFAULT 5
);

ALTER TABLE compliance.construction_boq_line_items ADD CONSTRAINT construction_boq_line_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_boqs ADD CONSTRAINT construction_boqs_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_change_orders ADD CONSTRAINT construction_change_orders_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_customer_complaints ADD CONSTRAINT construction_customer_complaints_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_interim_bill_line_items ADD CONSTRAINT construction_interim_bill_line_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_interim_bills ADD CONSTRAINT construction_interim_bills_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_labour_roster ADD CONSTRAINT construction_labour_roster_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_material_issues ADD CONSTRAINT construction_material_issues_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_materials ADD CONSTRAINT construction_materials_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_punch_list_items ADD CONSTRAINT construction_punch_list_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_site_diaries ADD CONSTRAINT construction_site_diaries_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_vendor_disputes ADD CONSTRAINT construction_vendor_disputes_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_work_progress_entries ADD CONSTRAINT construction_work_progress_entries_pkey PRIMARY KEY (id);
ALTER TABLE compliance.documents ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
ALTER TABLE compliance.erp_purchase_invoice_items ADD CONSTRAINT erp_purchase_invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE compliance.erp_purchase_invoices ADD CONSTRAINT erp_purchase_invoices_pkey PRIMARY KEY (id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE compliance.construction_boqs ADD CONSTRAINT construction_boqs_parent_boq_id_unique UNIQUE (parent_boq_id);
ALTER TABLE compliance.construction_site_diaries ADD CONSTRAINT construction_site_diaries_project_date_unique UNIQUE (project_id, diary_date);
ALTER TABLE compliance.erp_purchase_invoices ADD CONSTRAINT erp_purchase_invoices_org_id_invoice_number_key UNIQUE (org_id, invoice_number);
ALTER TABLE compliance.construction_work_progress_entries ADD CONSTRAINT construction_work_progress_entries_entry_basis_check CHECK ((entry_basis = ANY (ARRAY['DELTA'::text, 'SNAPSHOT'::text])));
ALTER TABLE compliance.construction_material_issues ADD CONSTRAINT construction_material_issues_material_id_fkey FOREIGN KEY (material_id) REFERENCES compliance.construction_materials(id) ON DELETE RESTRICT;
ALTER TABLE compliance.construction_work_progress_entries ADD CONSTRAINT construction_work_progress_entries_boq_line_item_id_fkey FOREIGN KEY (boq_line_item_id) REFERENCES compliance.construction_boq_line_items(id) ON DELETE SET NULL;
ALTER TABLE compliance.erp_purchase_invoice_items ADD CONSTRAINT erp_purchase_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES compliance.erp_purchase_invoices(id);
ALTER TABLE compliance.projects ADD CONSTRAINT projects_parent_project_id_fkey FOREIGN KEY (parent_project_id) REFERENCES compliance.projects(id);
