-- Wave 49 (VERI ERP, part 1/4): new 'erp' product branch + Accounting
-- schema (chart of accounts, journal entries, tax templates, currencies,
-- bank accounts, payment entries, sales/purchase invoices). Adapted from
-- studying frappe/erpnext's real Account/Journal Entry/Sales Invoice/
-- Purchase Invoice doctype field shapes -- never their code, never their
-- AI. Scoped per the user's explicit decision: a "Broader ERP core"
-- (Accounting + Assets + basic Buying/Selling/Stock), deliberately
-- excluding Manufacturing, Quality Management, and vertical-specific
-- modules. Schema-only wave -- no service layer or UI ships yet.

-- ============================================================
-- Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.erp_account_root_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.erp_journal_entry_status AS ENUM ('draft', 'submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.erp_invoice_status AS ENUM ('draft', 'submitted', 'partially_paid', 'paid', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.erp_payment_type AS ENUM ('receive', 'pay');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.erp_party_type AS ENUM ('customer', 'supplier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- New product branch: VERIDIAN's third opt-in branch after 'grc' and
-- 'pms'. Reuses the existing org_product_branch_enablements table
-- (Wave 25) as-is -- it's already branch-agnostic.
-- ============================================================
INSERT INTO compliance.product_branches (branch_key, display_name, domain, description) VALUES
  ('erp', 'VERI ERP', 'erp', 'Accounting, Assets, Buying, Selling, and basic Stock -- an opt-in operational core for orgs that want VERIDIAN to also run their own business finances, separate from client compliance work. Disabled by default.')
ON CONFLICT (branch_key) DO NOTHING;

-- ============================================================
-- Chart of accounts (tree via parent_account_id self-FK)
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.erp_accounts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  account_name text NOT NULL,
  account_number text,
  parent_account_id text REFERENCES compliance.erp_accounts(id),
  root_type compliance.erp_account_root_type NOT NULL,
  account_type text,
  is_group boolean NOT NULL DEFAULT false,
  currency_id text,
  is_frozen boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_fiscal_years (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  year_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, year_name)
);

CREATE TABLE IF NOT EXISTS compliance.erp_currencies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  code text NOT NULL,
  name text NOT NULL,
  symbol text,
  is_base_currency boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, code)
);

ALTER TABLE compliance.erp_accounts ADD CONSTRAINT erp_accounts_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES compliance.erp_currencies(id);

CREATE TABLE IF NOT EXISTS compliance.erp_exchange_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  from_currency_id text NOT NULL REFERENCES compliance.erp_currencies(id),
  to_currency_id text NOT NULL REFERENCES compliance.erp_currencies(id),
  rate numeric NOT NULL,
  rate_date date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_bank_accounts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  account_name text NOT NULL,
  bank_name text,
  account_number text,
  ifsc_or_swift text,
  currency_id text REFERENCES compliance.erp_currencies(id),
  gl_account_id text REFERENCES compliance.erp_accounts(id),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_tax_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  is_sales_tax boolean NOT NULL DEFAULT false,
  is_purchase_tax boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_tax_template_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tax_template_id text NOT NULL REFERENCES compliance.erp_tax_templates(id),
  tax_account_id text NOT NULL REFERENCES compliance.erp_accounts(id),
  rate numeric NOT NULL,
  description text
);

-- ============================================================
-- Journal entries -- the GL. status='submitted' rows are treated as
-- immutable by the service layer (Wave 50+), matching this codebase's
-- established publish/lock convention (veriMeetings.status).
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.erp_journal_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  entry_number integer NOT NULL,
  posting_date date NOT NULL,
  reference_type text,
  reference_id text,
  user_remark text,
  is_opening_entry boolean NOT NULL DEFAULT false,
  status compliance.erp_journal_entry_status NOT NULL DEFAULT 'draft',
  total_debit numeric NOT NULL DEFAULT 0,
  total_credit numeric NOT NULL DEFAULT 0,
  created_by_id text REFERENCES compliance.users(id),
  submitted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, entry_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_journal_entry_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  journal_entry_id text NOT NULL REFERENCES compliance.erp_journal_entries(id),
  account_id text NOT NULL REFERENCES compliance.erp_accounts(id),
  party_type compliance.erp_party_type,
  party_id text,
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  cost_center text,
  client_id text REFERENCES compliance.clients(id),
  remark text
);

CREATE TABLE IF NOT EXISTS compliance.erp_payment_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  payment_type compliance.erp_payment_type NOT NULL,
  party_type compliance.erp_party_type NOT NULL,
  party_id text NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  received_amount numeric NOT NULL DEFAULT 0,
  bank_account_id text REFERENCES compliance.erp_bank_accounts(id),
  reference_no text,
  reference_date date,
  posting_date date NOT NULL,
  status compliance.erp_journal_entry_status NOT NULL DEFAULT 'draft',
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- Sales / Purchase invoices -- party FKs (customer_id/supplier_id) are
-- added as real foreign keys in migration 0043 once erp_customers/
-- erp_suppliers exist, to avoid a forward-reference ordering problem.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.erp_sales_invoices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  customer_id text NOT NULL,
  invoice_number integer NOT NULL,
  posting_date date NOT NULL,
  due_date date,
  currency_id text REFERENCES compliance.erp_currencies(id),
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  outstanding_amount numeric NOT NULL DEFAULT 0,
  status compliance.erp_invoice_status NOT NULL DEFAULT 'draft',
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  sales_order_id text,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_sales_invoice_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id text NOT NULL REFERENCES compliance.erp_sales_invoices(id),
  item_id text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  tax_template_id text REFERENCES compliance.erp_tax_templates(id)
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_invoices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL,
  invoice_number integer NOT NULL,
  posting_date date NOT NULL,
  due_date date,
  currency_id text REFERENCES compliance.erp_currencies(id),
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  outstanding_amount numeric NOT NULL DEFAULT 0,
  status compliance.erp_invoice_status NOT NULL DEFAULT 'draft',
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  purchase_order_id text,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_invoice_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id text NOT NULL REFERENCES compliance.erp_purchase_invoices(id),
  item_id text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  tax_template_id text REFERENCES compliance.erp_tax_templates(id)
);

-- ============================================================
-- RLS: standard app_runtime_org_scoped + service_role_bypass
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_accounts', 'erp_fiscal_years', 'erp_currencies', 'erp_exchange_rates',
    'erp_bank_accounts', 'erp_tax_templates', 'erp_tax_template_items',
    'erp_journal_entries', 'erp_journal_entry_lines', 'erp_payment_entries',
    'erp_sales_invoices', 'erp_sales_invoice_items',
    'erp_purchase_invoices', 'erp_purchase_invoice_items'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Tables with a direct org_id column
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_accounts', 'erp_fiscal_years', 'erp_currencies', 'erp_exchange_rates',
    'erp_bank_accounts', 'erp_tax_templates',
    'erp_journal_entries', 'erp_payment_entries',
    'erp_sales_invoices', 'erp_purchase_invoices'
  ])
  LOOP
    EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tables scoped via a parent's org_id (no direct org_id column)
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_tax_template_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_tax_templates tt WHERE tt.id = erp_tax_template_items.tax_template_id AND tt.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_journal_entry_lines FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_journal_entries je WHERE je.id = erp_journal_entry_lines.journal_entry_id AND je.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_sales_invoice_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_sales_invoices si WHERE si.id = erp_sales_invoice_items.invoice_id AND si.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_invoice_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_purchase_invoices pi WHERE pi.id = erp_purchase_invoice_items.invoice_id AND pi.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_accounts', 'erp_fiscal_years', 'erp_currencies', 'erp_exchange_rates',
    'erp_bank_accounts', 'erp_tax_templates', 'erp_tax_template_items',
    'erp_journal_entries', 'erp_journal_entry_lines', 'erp_payment_entries',
    'erp_sales_invoices', 'erp_sales_invoice_items',
    'erp_purchase_invoices', 'erp_purchase_invoice_items'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_accounts, compliance.erp_fiscal_years, compliance.erp_currencies, compliance.erp_exchange_rates,
  compliance.erp_bank_accounts, compliance.erp_tax_templates, compliance.erp_tax_template_items,
  compliance.erp_journal_entries, compliance.erp_journal_entry_lines, compliance.erp_payment_entries,
  compliance.erp_sales_invoices, compliance.erp_sales_invoice_items,
  compliance.erp_purchase_invoices, compliance.erp_purchase_invoice_items
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_accounts, compliance.erp_fiscal_years, compliance.erp_currencies, compliance.erp_exchange_rates,
  compliance.erp_bank_accounts, compliance.erp_tax_templates, compliance.erp_tax_template_items,
  compliance.erp_journal_entries, compliance.erp_journal_entry_lines, compliance.erp_payment_entries,
  compliance.erp_sales_invoices, compliance.erp_sales_invoice_items,
  compliance.erp_purchase_invoices, compliance.erp_purchase_invoice_items
  TO service_role;

-- ============================================================
-- Covering indexes on every FK
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_accounts_org_id ON compliance.erp_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_accounts_parent_account_id ON compliance.erp_accounts(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_accounts_currency_id ON compliance.erp_accounts(currency_id);
CREATE INDEX IF NOT EXISTS idx_erp_fiscal_years_org_id ON compliance.erp_fiscal_years(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_currencies_org_id ON compliance.erp_currencies(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_exchange_rates_org_id ON compliance.erp_exchange_rates(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_exchange_rates_from_currency_id ON compliance.erp_exchange_rates(from_currency_id);
CREATE INDEX IF NOT EXISTS idx_erp_exchange_rates_to_currency_id ON compliance.erp_exchange_rates(to_currency_id);
CREATE INDEX IF NOT EXISTS idx_erp_bank_accounts_org_id ON compliance.erp_bank_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_bank_accounts_currency_id ON compliance.erp_bank_accounts(currency_id);
CREATE INDEX IF NOT EXISTS idx_erp_bank_accounts_gl_account_id ON compliance.erp_bank_accounts(gl_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_tax_templates_org_id ON compliance.erp_tax_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_tax_template_items_tax_template_id ON compliance.erp_tax_template_items(tax_template_id);
CREATE INDEX IF NOT EXISTS idx_erp_tax_template_items_tax_account_id ON compliance.erp_tax_template_items(tax_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_entries_org_id ON compliance.erp_journal_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_entries_created_by_id ON compliance.erp_journal_entries(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_entry_lines_journal_entry_id ON compliance.erp_journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_entry_lines_account_id ON compliance.erp_journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_entry_lines_client_id ON compliance.erp_journal_entry_lines(client_id);
CREATE INDEX IF NOT EXISTS idx_erp_payment_entries_org_id ON compliance.erp_payment_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_payment_entries_bank_account_id ON compliance.erp_payment_entries(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_payment_entries_journal_entry_id ON compliance.erp_payment_entries(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_org_id ON compliance.erp_sales_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_client_id ON compliance.erp_sales_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_customer_id ON compliance.erp_sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_currency_id ON compliance.erp_sales_invoices(currency_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_journal_entry_id ON compliance.erp_sales_invoices(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_created_by_id ON compliance.erp_sales_invoices(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoice_items_invoice_id ON compliance.erp_sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoice_items_tax_template_id ON compliance.erp_sales_invoice_items(tax_template_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_org_id ON compliance.erp_purchase_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_supplier_id ON compliance.erp_purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_currency_id ON compliance.erp_purchase_invoices(currency_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_journal_entry_id ON compliance.erp_purchase_invoices(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_created_by_id ON compliance.erp_purchase_invoices(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoice_items_invoice_id ON compliance.erp_purchase_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoice_items_tax_template_id ON compliance.erp_purchase_invoice_items(tax_template_id);

-- ============================================================
-- Module Registry seed: Accounting modules, domain='erp', linked to the
-- 'erp' branch only.
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_accounts', 'Chart of Accounts', 'erp_accounts', 'erp', 'Accounting', false, 'General ledger accounts, tree-structured'),
  ('erp_journal_entries', 'Journal Entries', 'erp_journal_entries', 'erp', 'Accounting', false, 'Double-entry journal postings'),
  ('erp_invoices', 'Sales & Purchase Invoices', 'erp_sales_invoices', 'erp', 'Accounting', false, 'Customer and supplier invoicing'),
  ('erp_payments', 'Payment Entries', 'erp_payment_entries', 'erp', 'Accounting', false, 'Payments received and made')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp'
  AND mr.module_key IN ('erp_accounts', 'erp_journal_entries', 'erp_invoices', 'erp_payments')
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
