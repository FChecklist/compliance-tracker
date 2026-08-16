-- Wave 52 (VERI ERP gap-fill, Tier 2/3): Cost Centers, Cash Management,
-- Sales/Purchase Credit Notes. Per ERP_BENCHMARK_COMPARISON.md's ranking,
-- batched into one migration since each is additive and independent.

DO $$ BEGIN
  CREATE TYPE compliance.erp_cash_voucher_type AS ENUM ('receipt', 'payment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_cash_voucher_status AS ENUM ('draft', 'submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_credit_note_status AS ENUM ('draft', 'submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cost Centers
CREATE TABLE IF NOT EXISTS compliance.erp_cost_centers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  parent_cost_center_id text REFERENCES compliance.erp_cost_centers(id),
  is_group boolean NOT NULL DEFAULT false,
  department_id text REFERENCES compliance.departments(id),
  project_id text REFERENCES compliance.projects(id),
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.erp_journal_entry_lines ADD COLUMN IF NOT EXISTS cost_center_id text REFERENCES compliance.erp_cost_centers(id);

-- Cash Management
CREATE TABLE IF NOT EXISTS compliance.erp_cash_accounts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  account_name text NOT NULL,
  gl_account_id text REFERENCES compliance.erp_accounts(id),
  is_petty_cash boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_cash_vouchers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  cash_account_id text NOT NULL REFERENCES compliance.erp_cash_accounts(id),
  voucher_number integer NOT NULL,
  voucher_type compliance.erp_cash_voucher_type NOT NULL,
  amount numeric NOT NULL,
  party_type compliance.erp_party_type,
  party_id text,
  posting_date date NOT NULL,
  status compliance.erp_cash_voucher_status NOT NULL DEFAULT 'draft',
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  remark text,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- Sales Credit Notes
CREATE TABLE IF NOT EXISTS compliance.erp_sales_credit_notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  customer_id text NOT NULL REFERENCES compliance.erp_customers(id),
  sales_invoice_id text REFERENCES compliance.erp_sales_invoices(id),
  credit_note_number integer NOT NULL,
  posting_date date NOT NULL,
  reason text,
  status compliance.erp_credit_note_status NOT NULL DEFAULT 'draft',
  total_amount numeric NOT NULL DEFAULT 0,
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_sales_credit_note_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  credit_note_id text NOT NULL REFERENCES compliance.erp_sales_credit_notes(id) ON DELETE CASCADE,
  item_id text REFERENCES compliance.erp_items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0
);

-- Purchase Credit Notes (debit notes)
CREATE TABLE IF NOT EXISTS compliance.erp_purchase_credit_notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id),
  purchase_invoice_id text REFERENCES compliance.erp_purchase_invoices(id),
  credit_note_number integer NOT NULL,
  posting_date date NOT NULL,
  reason text,
  status compliance.erp_credit_note_status NOT NULL DEFAULT 'draft',
  total_amount numeric NOT NULL DEFAULT 0,
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_credit_note_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  credit_note_id text NOT NULL REFERENCES compliance.erp_purchase_credit_notes(id) ON DELETE CASCADE,
  item_id text REFERENCES compliance.erp_items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0
);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_cost_centers', 'erp_cash_accounts', 'erp_cash_vouchers',
    'erp_sales_credit_notes', 'erp_sales_credit_note_items',
    'erp_purchase_credit_notes', 'erp_purchase_credit_note_items'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_cost_centers', 'erp_cash_accounts', 'erp_cash_vouchers',
    'erp_sales_credit_notes', 'erp_purchase_credit_notes'
  ])
  LOOP
    EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_sales_credit_note_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_sales_credit_notes cn WHERE cn.id = erp_sales_credit_note_items.credit_note_id AND cn.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_credit_note_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_purchase_credit_notes cn WHERE cn.id = erp_purchase_credit_note_items.credit_note_id AND cn.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_cost_centers', 'erp_cash_accounts', 'erp_cash_vouchers',
    'erp_sales_credit_notes', 'erp_sales_credit_note_items',
    'erp_purchase_credit_notes', 'erp_purchase_credit_note_items'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_cost_centers, compliance.erp_cash_accounts, compliance.erp_cash_vouchers,
  compliance.erp_sales_credit_notes, compliance.erp_sales_credit_note_items,
  compliance.erp_purchase_credit_notes, compliance.erp_purchase_credit_note_items
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_cost_centers, compliance.erp_cash_accounts, compliance.erp_cash_vouchers,
  compliance.erp_sales_credit_notes, compliance.erp_sales_credit_note_items,
  compliance.erp_purchase_credit_notes, compliance.erp_purchase_credit_note_items
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_cost_centers_org_id ON compliance.erp_cost_centers(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_cost_centers_parent_id ON compliance.erp_cost_centers(parent_cost_center_id);
CREATE INDEX IF NOT EXISTS idx_erp_cost_centers_department_id ON compliance.erp_cost_centers(department_id);
CREATE INDEX IF NOT EXISTS idx_erp_cost_centers_project_id ON compliance.erp_cost_centers(project_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_entry_lines_cost_center_id ON compliance.erp_journal_entry_lines(cost_center_id);

CREATE INDEX IF NOT EXISTS idx_erp_cash_accounts_org_id ON compliance.erp_cash_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_cash_accounts_gl_account_id ON compliance.erp_cash_accounts(gl_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_cash_vouchers_org_id ON compliance.erp_cash_vouchers(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_cash_vouchers_cash_account_id ON compliance.erp_cash_vouchers(cash_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_cash_vouchers_journal_entry_id ON compliance.erp_cash_vouchers(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_cash_vouchers_created_by_id ON compliance.erp_cash_vouchers(created_by_id);

CREATE INDEX IF NOT EXISTS idx_erp_sales_credit_notes_org_id ON compliance.erp_sales_credit_notes(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_credit_notes_customer_id ON compliance.erp_sales_credit_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_credit_notes_sales_invoice_id ON compliance.erp_sales_credit_notes(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_credit_notes_journal_entry_id ON compliance.erp_sales_credit_notes(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_credit_notes_created_by_id ON compliance.erp_sales_credit_notes(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_credit_note_items_credit_note_id ON compliance.erp_sales_credit_note_items(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_credit_note_items_item_id ON compliance.erp_sales_credit_note_items(item_id);

CREATE INDEX IF NOT EXISTS idx_erp_purchase_credit_notes_org_id ON compliance.erp_purchase_credit_notes(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_credit_notes_supplier_id ON compliance.erp_purchase_credit_notes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_credit_notes_purchase_invoice_id ON compliance.erp_purchase_credit_notes(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_credit_notes_journal_entry_id ON compliance.erp_purchase_credit_notes(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_credit_notes_created_by_id ON compliance.erp_purchase_credit_notes(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_credit_note_items_credit_note_id ON compliance.erp_purchase_credit_note_items(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_credit_note_items_item_id ON compliance.erp_purchase_credit_note_items(item_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_cost_centers', 'Cost Centers', 'erp_cost_centers', 'erp', 'Accounting', false, 'Multidimensional cost accounting'),
  ('erp_cash_management', 'Cash Management', 'erp_cash_accounts', 'erp', 'Accounting', false, 'Petty cash, cash receipts/payments'),
  ('erp_credit_notes', 'Credit Notes', 'erp_sales_credit_notes', 'erp', 'Accounting', false, 'Sales and purchase credit/debit notes')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key IN ('erp_cost_centers', 'erp_cash_management', 'erp_credit_notes')
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
