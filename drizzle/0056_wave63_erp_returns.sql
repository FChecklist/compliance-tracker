-- Wave 63: RMA/Returns Workflow -- Tier 3 #11 remainder. ERPNext itself only
-- flags returns with no real workflow -- this is a genuine in-house design,
-- reusing the existing FIFO stock engine (recordStockReceipt/recordStockIssue)
-- and existing sales/purchase credit notes for the financial side rather
-- than inventing parallel mechanisms.

DO $$ BEGIN
  CREATE TYPE compliance.erp_sales_return_status AS ENUM ('requested', 'approved', 'received', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_purchase_return_status AS ENUM ('requested', 'approved', 'dispatched', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_sales_returns (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  customer_id text NOT NULL REFERENCES compliance.erp_customers(id),
  sales_invoice_id text REFERENCES compliance.erp_sales_invoices(id),
  warehouse_id text NOT NULL REFERENCES compliance.erp_warehouses(id),
  reason text,
  status compliance.erp_sales_return_status NOT NULL DEFAULT 'requested',
  credit_note_id text REFERENCES compliance.erp_sales_credit_notes(id),
  requested_by_id text NOT NULL REFERENCES compliance.users(id),
  approved_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_sales_return_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  return_id text NOT NULL REFERENCES compliance.erp_sales_returns(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  quantity numeric NOT NULL,
  rate numeric NOT NULL DEFAULT 0,
  reason text
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_returns (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id),
  purchase_invoice_id text REFERENCES compliance.erp_purchase_invoices(id),
  warehouse_id text NOT NULL REFERENCES compliance.erp_warehouses(id),
  reason text,
  status compliance.erp_purchase_return_status NOT NULL DEFAULT 'requested',
  credit_note_id text REFERENCES compliance.erp_purchase_credit_notes(id),
  requested_by_id text NOT NULL REFERENCES compliance.users(id),
  approved_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_return_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  return_id text NOT NULL REFERENCES compliance.erp_purchase_returns(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  quantity numeric NOT NULL,
  rate numeric NOT NULL DEFAULT 0,
  reason text
);

ALTER TABLE compliance.erp_sales_returns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_sales_returns FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_sales_returns ON compliance.erp_sales_returns FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_sales_returns TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_sales_returns TO service_role;

ALTER TABLE compliance.erp_sales_return_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_sales_return_items FOR ALL TO app_runtime
    USING (return_id IN (SELECT id FROM compliance.erp_sales_returns WHERE org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_sales_return_items ON compliance.erp_sales_return_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_sales_return_items TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_sales_return_items TO service_role;

ALTER TABLE compliance.erp_purchase_returns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_returns FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_purchase_returns ON compliance.erp_purchase_returns FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_purchase_returns TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_purchase_returns TO service_role;

ALTER TABLE compliance.erp_purchase_return_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_return_items FOR ALL TO app_runtime
    USING (return_id IN (SELECT id FROM compliance.erp_purchase_returns WHERE org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_purchase_return_items ON compliance.erp_purchase_return_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_purchase_return_items TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_purchase_return_items TO service_role;

CREATE INDEX IF NOT EXISTS idx_erp_sales_returns_org_id ON compliance.erp_sales_returns(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_returns_customer_id ON compliance.erp_sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_return_items_return_id ON compliance.erp_sales_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_returns_org_id ON compliance.erp_purchase_returns(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_returns_supplier_id ON compliance.erp_purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_return_items_return_id ON compliance.erp_purchase_return_items(return_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_sales_returns', 'Sales Returns (RMA)', 'erp_sales_returns', 'erp', 'Selling', false, 'Customer return requests, approved and received back into stock via the FIFO engine'),
  ('erp_purchase_returns', 'Purchase Returns (RMA)', 'erp_purchase_returns', 'erp', 'Buying', false, 'Supplier return requests, approved and dispatched out of stock via the FIFO engine')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key IN ('erp_sales_returns', 'erp_purchase_returns')
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
