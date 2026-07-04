-- Wave 49 (VERI ERP, part 3/4): Buying (suppliers, purchase orders,
-- purchase receipts) + Selling (customers, quotations, sales orders,
-- delivery notes). Also closes the forward-reference FKs on
-- erp_sales_invoices.customer_id / erp_purchase_invoices.supplier_id /
-- erp_sales_invoices.sales_order_id / erp_purchase_invoices.purchase_order_id
-- left as plain text in migration 0041, since erp_customers/erp_suppliers/
-- erp_sales_orders/erp_purchase_orders didn't exist yet at that point.

-- ============================================================
-- Buying
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.erp_suppliers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_name text NOT NULL,
  supplier_type text,
  gstin text,
  pan_number text,
  default_payment_terms_days integer,
  vendor_risk_profile_id text REFERENCES compliance.vendor_risk_profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id),
  po_number integer NOT NULL,
  order_date date NOT NULL,
  expected_delivery_date date,
  status text NOT NULL DEFAULT 'draft',
  grand_total numeric NOT NULL DEFAULT 0,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, po_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_order_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  purchase_order_id text NOT NULL REFERENCES compliance.erp_purchase_orders(id),
  item_id text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  received_quantity numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_receipts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id),
  purchase_order_id text REFERENCES compliance.erp_purchase_orders(id),
  receipt_number integer NOT NULL,
  posting_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, receipt_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_receipt_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receipt_id text NOT NULL REFERENCES compliance.erp_purchase_receipts(id),
  purchase_order_item_id text REFERENCES compliance.erp_purchase_order_items(id),
  item_id text,
  quantity numeric NOT NULL DEFAULT 1,
  warehouse_id text
);

-- ============================================================
-- Selling
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.erp_customers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  customer_name text NOT NULL,
  client_id text REFERENCES compliance.clients(id),
  gstin text,
  pan_number text,
  default_payment_terms_days integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_quotations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  customer_id text REFERENCES compliance.erp_customers(id),
  lead_id text REFERENCES compliance.crm_leads(id),
  quotation_number integer NOT NULL,
  quotation_date date NOT NULL,
  valid_till date,
  status text NOT NULL DEFAULT 'draft',
  grand_total numeric NOT NULL DEFAULT 0,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, quotation_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_quotation_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  quotation_id text NOT NULL REFERENCES compliance.erp_quotations(id),
  item_id text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance.erp_sales_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  customer_id text NOT NULL REFERENCES compliance.erp_customers(id),
  opportunity_id text REFERENCES compliance.crm_opportunities(id),
  quotation_id text REFERENCES compliance.erp_quotations(id),
  so_number integer NOT NULL,
  order_date date NOT NULL,
  delivery_date date,
  status text NOT NULL DEFAULT 'draft',
  grand_total numeric NOT NULL DEFAULT 0,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, so_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_sales_order_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sales_order_id text NOT NULL REFERENCES compliance.erp_sales_orders(id),
  item_id text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  delivered_quantity numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance.erp_delivery_notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  customer_id text NOT NULL REFERENCES compliance.erp_customers(id),
  sales_order_id text REFERENCES compliance.erp_sales_orders(id),
  delivery_number integer NOT NULL,
  posting_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, delivery_number)
);

CREATE TABLE IF NOT EXISTS compliance.erp_delivery_note_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  delivery_note_id text NOT NULL REFERENCES compliance.erp_delivery_notes(id),
  sales_order_item_id text REFERENCES compliance.erp_sales_order_items(id),
  item_id text,
  quantity numeric NOT NULL DEFAULT 1,
  warehouse_id text
);

-- ============================================================
-- Close the forward-reference FKs deferred from migration 0041
-- ============================================================
ALTER TABLE compliance.erp_sales_invoices ADD CONSTRAINT erp_sales_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES compliance.erp_customers(id);
ALTER TABLE compliance.erp_sales_invoices ADD CONSTRAINT erp_sales_invoices_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES compliance.erp_sales_orders(id);
ALTER TABLE compliance.erp_purchase_invoices ADD CONSTRAINT erp_purchase_invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES compliance.erp_suppliers(id);
ALTER TABLE compliance.erp_purchase_invoices ADD CONSTRAINT erp_purchase_invoices_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES compliance.erp_purchase_orders(id);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_suppliers', 'erp_purchase_orders', 'erp_purchase_order_items',
    'erp_purchase_receipts', 'erp_purchase_receipt_items',
    'erp_customers', 'erp_quotations', 'erp_quotation_items',
    'erp_sales_orders', 'erp_sales_order_items',
    'erp_delivery_notes', 'erp_delivery_note_items'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Direct org_id column
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_suppliers', 'erp_purchase_orders', 'erp_purchase_receipts',
    'erp_customers', 'erp_quotations', 'erp_sales_orders', 'erp_delivery_notes'
  ])
  LOOP
    EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Scoped via parent's org_id
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_order_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_purchase_orders po WHERE po.id = erp_purchase_order_items.purchase_order_id AND po.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_receipt_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_purchase_receipts pr WHERE pr.id = erp_purchase_receipt_items.receipt_id AND pr.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_quotation_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_quotations q WHERE q.id = erp_quotation_items.quotation_id AND q.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_sales_order_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_sales_orders so WHERE so.id = erp_sales_order_items.sales_order_id AND so.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_delivery_note_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_delivery_notes dn WHERE dn.id = erp_delivery_note_items.delivery_note_id AND dn.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_suppliers', 'erp_purchase_orders', 'erp_purchase_order_items',
    'erp_purchase_receipts', 'erp_purchase_receipt_items',
    'erp_customers', 'erp_quotations', 'erp_quotation_items',
    'erp_sales_orders', 'erp_sales_order_items',
    'erp_delivery_notes', 'erp_delivery_note_items'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_suppliers, compliance.erp_purchase_orders, compliance.erp_purchase_order_items,
  compliance.erp_purchase_receipts, compliance.erp_purchase_receipt_items,
  compliance.erp_customers, compliance.erp_quotations, compliance.erp_quotation_items,
  compliance.erp_sales_orders, compliance.erp_sales_order_items,
  compliance.erp_delivery_notes, compliance.erp_delivery_note_items
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_suppliers, compliance.erp_purchase_orders, compliance.erp_purchase_order_items,
  compliance.erp_purchase_receipts, compliance.erp_purchase_receipt_items,
  compliance.erp_customers, compliance.erp_quotations, compliance.erp_quotation_items,
  compliance.erp_sales_orders, compliance.erp_sales_order_items,
  compliance.erp_delivery_notes, compliance.erp_delivery_note_items
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_suppliers_org_id ON compliance.erp_suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_suppliers_vendor_risk_profile_id ON compliance.erp_suppliers(vendor_risk_profile_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_orders_org_id ON compliance.erp_purchase_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_orders_supplier_id ON compliance.erp_purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_orders_created_by_id ON compliance.erp_purchase_orders(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_order_items_purchase_order_id ON compliance.erp_purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_receipts_org_id ON compliance.erp_purchase_receipts(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_receipts_supplier_id ON compliance.erp_purchase_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_receipts_purchase_order_id ON compliance.erp_purchase_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_receipts_created_by_id ON compliance.erp_purchase_receipts(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_receipt_items_receipt_id ON compliance.erp_purchase_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_receipt_items_purchase_order_item_id ON compliance.erp_purchase_receipt_items(purchase_order_item_id);
CREATE INDEX IF NOT EXISTS idx_erp_customers_org_id ON compliance.erp_customers(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_customers_client_id ON compliance.erp_customers(client_id);
CREATE INDEX IF NOT EXISTS idx_erp_quotations_org_id ON compliance.erp_quotations(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_quotations_customer_id ON compliance.erp_quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_quotations_lead_id ON compliance.erp_quotations(lead_id);
CREATE INDEX IF NOT EXISTS idx_erp_quotations_created_by_id ON compliance.erp_quotations(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_quotation_items_quotation_id ON compliance.erp_quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_org_id ON compliance.erp_sales_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_customer_id ON compliance.erp_sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_opportunity_id ON compliance.erp_sales_orders(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_quotation_id ON compliance.erp_sales_orders(quotation_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_orders_created_by_id ON compliance.erp_sales_orders(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_order_items_sales_order_id ON compliance.erp_sales_order_items(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_erp_delivery_notes_org_id ON compliance.erp_delivery_notes(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_delivery_notes_customer_id ON compliance.erp_delivery_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_delivery_notes_sales_order_id ON compliance.erp_delivery_notes(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_erp_delivery_notes_created_by_id ON compliance.erp_delivery_notes(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_delivery_note_items_delivery_note_id ON compliance.erp_delivery_note_items(delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_erp_delivery_note_items_sales_order_item_id ON compliance.erp_delivery_note_items(sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_customer_id ON compliance.erp_sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_sales_order_id ON compliance.erp_sales_invoices(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_supplier_id ON compliance.erp_purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_purchase_order_id ON compliance.erp_purchase_invoices(purchase_order_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_buying', 'Buying', 'erp_purchase_orders', 'erp', 'Buying', false, 'Suppliers, purchase orders, purchase receipts'),
  ('erp_selling', 'Selling', 'erp_sales_orders', 'erp', 'Selling', false, 'Customers, quotations, sales orders, delivery notes')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key IN ('erp_buying', 'erp_selling')
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
