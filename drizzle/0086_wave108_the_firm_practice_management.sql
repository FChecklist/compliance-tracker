-- Wave 108 (THE FIRM AI OS -- Practice Management for CA/CS/Legal/GRC/
-- Audit firms): a firm owner (4-20 staff) serves many client companies and
-- individual taxpayees across some mix of the five service lines. The
-- client hierarchy (Wave 1/14-17) and the per-client-scoped compliance/
-- legal/company-secretarial/audit modules already do the heavy lifting --
-- confirmed via direct schema reads, none of that is rebuilt here. This
-- migration adds what's genuinely missing: per-client service-line
-- gating, an engagement/scope-of-work model, an Indian tax-notice/appeal
-- case workflow, staff-to-client capacity assignment, and client-billable
-- time + invoicing. Supersedes the two dormant, never-built `law_firm`/
-- `cs_firm` planned catalog rows from Wave 106 with one unified branch,
-- since the buyer wants ONE product across all five service lines, not
-- five separate branch toggles.

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.firm_service_line AS ENUM ('ca_services', 'cs_services', 'legal_services', 'grc_services', 'audit_services');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.firm_fee_type AS ENUM ('fixed', 'hourly', 'retainer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.firm_staff_role AS ENUM ('partner', 'manager', 'associate', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.firm_invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Tables (dependency order)
-- ============================================================

CREATE TABLE IF NOT EXISTS compliance.firm_client_service_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  service_line compliance.firm_service_line NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  lead_staff_user_id text REFERENCES compliance.users(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(client_id, service_line)
);

CREATE TABLE IF NOT EXISTS compliance.firm_engagements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  service_line compliance.firm_service_line NOT NULL,
  title text NOT NULL,
  scope_of_work text,
  fee_type compliance.firm_fee_type NOT NULL DEFAULT 'fixed',
  fee_amount numeric,
  billing_frequency text DEFAULT 'monthly',
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'active',
  lead_partner_user_id text REFERENCES compliance.users(id),
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.firm_engagement_deliverables (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  engagement_id text NOT NULL REFERENCES compliance.firm_engagements(id),
  title text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'pending',
  linked_entity_type text,
  linked_entity_id text,
  assigned_to_id text REFERENCES compliance.users(id),
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.firm_tax_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  assessment_year text NOT NULL,
  case_type text NOT NULL DEFAULT 'scrutiny',
  section_code text,
  authority text,
  forum text NOT NULL DEFAULT 'ao',
  stage text NOT NULL DEFAULT 'notice_received',
  due_date date,
  limitation_date date,
  demand_amount numeric,
  outcome text,
  linked_notice_id text REFERENCES compliance.notices(id),
  responsible_user_id text REFERENCES compliance.users(id),
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.firm_staff_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  role compliance.firm_staff_role NOT NULL DEFAULT 'staff',
  allocated_hours_per_week numeric,
  start_date date NOT NULL,
  end_date date,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(client_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS compliance.firm_time_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  engagement_id text REFERENCES compliance.firm_engagements(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  task_description text NOT NULL,
  hours numeric NOT NULL,
  spent_on date NOT NULL,
  billable boolean NOT NULL DEFAULT true,
  is_running boolean NOT NULL DEFAULT false,
  started_at timestamp,
  hourly_rate_snapshot numeric,
  invoice_line_item_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.firm_billable_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text REFERENCES compliance.users(id),
  client_id text REFERENCES compliance.clients(id),
  hourly_rate numeric NOT NULL,
  valid_from date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.firm_invoices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  engagement_id text REFERENCES compliance.firm_engagements(id),
  invoice_number text NOT NULL,
  issue_date date NOT NULL,
  due_date date,
  status compliance.firm_invoice_status NOT NULL DEFAULT 'draft',
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS compliance.firm_invoice_line_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  invoice_id text NOT NULL REFERENCES compliance.firm_invoices(id),
  description text NOT NULL,
  quantity_hours numeric,
  rate numeric,
  amount numeric NOT NULL,
  time_entry_id text REFERENCES compliance.firm_time_entries(id),
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE compliance.firm_time_entries ADD CONSTRAINT firm_time_entries_invoice_line_item_id_fkey FOREIGN KEY (invoice_line_item_id) REFERENCES compliance.firm_invoice_line_items(id);

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_firm_client_service_lines_org_id ON compliance.firm_client_service_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_client_service_lines_client_id ON compliance.firm_client_service_lines(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_engagements_org_id ON compliance.firm_engagements(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_engagements_client_id ON compliance.firm_engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_engagements_status ON compliance.firm_engagements(org_id, status);
CREATE INDEX IF NOT EXISTS idx_firm_engagement_deliverables_org_id ON compliance.firm_engagement_deliverables(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_engagement_deliverables_engagement_id ON compliance.firm_engagement_deliverables(engagement_id);
CREATE INDEX IF NOT EXISTS idx_firm_engagement_deliverables_due ON compliance.firm_engagement_deliverables(org_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_firm_tax_cases_org_id ON compliance.firm_tax_cases(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_tax_cases_client_id ON compliance.firm_tax_cases(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_tax_cases_limitation_date ON compliance.firm_tax_cases(org_id, limitation_date);
CREATE INDEX IF NOT EXISTS idx_firm_staff_assignments_org_id ON compliance.firm_staff_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_staff_assignments_user_id ON compliance.firm_staff_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_firm_staff_assignments_client_id ON compliance.firm_staff_assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_time_entries_org_id ON compliance.firm_time_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_time_entries_client_id ON compliance.firm_time_entries(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_time_entries_unbilled ON compliance.firm_time_entries(org_id, client_id, billable, invoice_line_item_id);
CREATE INDEX IF NOT EXISTS idx_firm_billable_rates_org_id ON compliance.firm_billable_rates(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_invoices_org_id ON compliance.firm_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_invoices_client_id ON compliance.firm_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_invoice_line_items_invoice_id ON compliance.firm_invoice_line_items(invoice_id);

-- ============================================================
-- 4. RLS -- standard org-scoped pair per table, each CREATE POLICY in its
--    own BEGIN/EXCEPTION block (the exact idempotency fix Wave 107
--    applied -- a single handler around the whole loop would abort
--    processing of every remaining table at the first duplicate policy).
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'firm_client_service_lines', 'firm_engagements', 'firm_engagement_deliverables',
    'firm_tax_cases', 'firm_staff_assignments', 'firm_time_entries',
    'firm_billable_rates', 'firm_invoices', 'firm_invoice_line_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO app_runtime', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO service_role', t);
  END LOOP;
END $$;

-- ============================================================
-- 5. Seed: product_branches -- new 'the_firm' row, deprecate the two
--    dormant law_firm/cs_firm rows seeded (never built) in Wave 106
-- ============================================================
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('the_firm', 'THE FIRM AI OS', 'the_firm',
   'Practice management for a CA/CS/Legal/GRC/Audit firm: per-client service-line scoping, engagements, Indian tax-case workflow, staff assignment, and time/billing across every existing GRC/Legal/CS/Audit module.',
   'Run your practice like the Big 4 do', 'Briefcase', 'planned', 15, 'professional_services', 'moderate_build')
ON CONFLICT (branch_key) DO NOTHING;

UPDATE compliance.product_branches
SET status = 'deprecated',
    description = description || ' -- Superseded by the unified the_firm branch (Wave 108); kept as a historical catalog record, not re-registered standalone.'
WHERE branch_key IN ('law_firm', 'cs_firm') AND status != 'deprecated';

-- ============================================================
-- 6. Seed: module registry (new tables only) + product_branch_modules
--    links -- reuses the already-built GRC/Legal/CS/Audit modules
--    (confirmed exact module_key spellings via a live query before
--    writing this section) rather than re-registering them.
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('firm_client_service_lines', 'Client Service-Line Scoping', 'firm_client_service_lines', 'the_firm', 'PRACTICE_MANAGEMENT', false, 'Per-client toggle for which of CA/CS/Legal/GRC/Audit services a client receives'),
  ('firm_engagements', 'Firm Engagements', 'firm_engagements', 'the_firm', 'PRACTICE_MANAGEMENT', false, 'Scope-of-work and fee arrangement per client per service line, with deliverables tracking'),
  ('firm_tax_cases', 'Tax Case Workflow', 'firm_tax_cases', 'the_firm', 'TAX_LITIGATION', false, 'Indian income-tax/GST notice, assessment, and appeal workflow with limitation-date tracking'),
  ('firm_staff_assignments', 'Staff Assignment & Capacity', 'firm_staff_assignments', 'the_firm', 'PRACTICE_MANAGEMENT', false, 'Client-to-staff assignment with allocated hours/week for utilization tracking'),
  ('firm_time_billing', 'Time Tracking & Billing', 'firm_time_entries', 'the_firm', 'BILLING', false, 'Client-scoped time entries, billable-rate resolution, and invoice generation from unbilled time')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'the_firm'
  AND mr.module_key IN (
    -- new this wave
    'firm_client_service_lines', 'firm_engagements', 'firm_tax_cases',
    'firm_staff_assignments', 'firm_time_billing',
    -- reused: already-built, already-per-client-scoped modules
    'compliance_items', 'notices', 'challans', 'audit_points',
    'litigation_matters', 'ip_portfolio', 'legal_opinions', 'legal_vendors',
    'cap_table_entries', 'cap_table_events', 'company_charges', 'mca_filings', 'secretarial_audits',
    'audit_engagements', 'audit_findings', 'framework_controls', 'compliance_frameworks'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. Promote the_firm from 'planned' to 'building'
-- ============================================================
UPDATE compliance.product_branches SET status = 'building' WHERE branch_key = 'the_firm';
