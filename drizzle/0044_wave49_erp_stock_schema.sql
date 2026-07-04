-- Wave 49 (VERI ERP, part 4/4): basic Stock/Inventory (warehouses, items,
-- item groups, append-only stock ledger, stock reconciliation). Deliberately
-- basic per the user's chosen "broader ERP core" scope -- no batch/serial
-- tracking, no valuation-method configuration (FIFO/Moving Average), no
-- manufacturing/BOM integration. Also closes the forward-reference FKs on
-- erp_purchase_receipt_items.warehouse_id / erp_delivery_note_items.warehouse_id
-- left as plain text in migration 0043, since erp_warehouses didn't exist yet.

CREATE TABLE IF NOT EXISTS compliance.erp_warehouses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  warehouse_name text NOT NULL,
  parent_warehouse_id text REFERENCES compliance.erp_warehouses(id),
  is_group boolean NOT NULL DEFAULT false,
  address text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_item_groups (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  group_name text NOT NULL,
  parent_group_id text REFERENCES compliance.erp_item_groups(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_code text NOT NULL,
  item_name text NOT NULL,
  item_group_id text REFERENCES compliance.erp_item_groups(id),
  uom text,
  is_stock_item boolean NOT NULL DEFAULT true,
  is_sales_item boolean NOT NULL DEFAULT true,
  is_purchase_item boolean NOT NULL DEFAULT true,
  standard_selling_rate numeric,
  standard_buying_rate numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, item_code)
);

CREATE TABLE IF NOT EXISTS compliance.erp_stock_ledger_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  warehouse_id text NOT NULL REFERENCES compliance.erp_warehouses(id),
  posting_date date NOT NULL,
  voucher_type text NOT NULL,
  voucher_id text NOT NULL,
  quantity_change numeric NOT NULL,
  valuation_rate numeric NOT NULL DEFAULT 0,
  balance_qty numeric NOT NULL,
  balance_value numeric NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_stock_reconciliations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  warehouse_id text NOT NULL REFERENCES compliance.erp_warehouses(id),
  posting_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_stock_reconciliation_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reconciliation_id text NOT NULL REFERENCES compliance.erp_stock_reconciliations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  counted_qty numeric NOT NULL,
  valuation_rate numeric NOT NULL DEFAULT 0,
  system_qty numeric
);

-- ============================================================
-- Close forward-reference FKs deferred from migration 0043
-- ============================================================
ALTER TABLE compliance.erp_purchase_receipt_items ADD CONSTRAINT erp_purchase_receipt_items_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES compliance.erp_warehouses(id);
ALTER TABLE compliance.erp_delivery_note_items ADD CONSTRAINT erp_delivery_note_items_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES compliance.erp_warehouses(id);

-- Also close the item_id forward-references across every ERP line-item
-- table that referenced erp_items before it existed (all left as plain
-- text since erp_items is defined in this final schema file).
ALTER TABLE compliance.erp_sales_invoice_items ADD CONSTRAINT erp_sales_invoice_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES compliance.erp_items(id);
ALTER TABLE compliance.erp_purchase_invoice_items ADD CONSTRAINT erp_purchase_invoice_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES compliance.erp_items(id);
ALTER TABLE compliance.erp_purchase_order_items ADD CONSTRAINT erp_purchase_order_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES compliance.erp_items(id);
ALTER TABLE compliance.erp_purchase_receipt_items ADD CONSTRAINT erp_purchase_receipt_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES compliance.erp_items(id);
ALTER TABLE compliance.erp_quotation_items ADD CONSTRAINT erp_quotation_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES compliance.erp_items(id);
ALTER TABLE compliance.erp_sales_order_items ADD CONSTRAINT erp_sales_order_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES compliance.erp_items(id);
ALTER TABLE compliance.erp_delivery_note_items ADD CONSTRAINT erp_delivery_note_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES compliance.erp_items(id);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_warehouses', 'erp_item_groups', 'erp_items',
    'erp_stock_ledger_entries', 'erp_stock_reconciliations', 'erp_stock_reconciliation_items'
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
    'erp_warehouses', 'erp_item_groups', 'erp_items',
    'erp_stock_ledger_entries', 'erp_stock_reconciliations'
  ])
  LOOP
    EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_stock_reconciliation_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_stock_reconciliations sr WHERE sr.id = erp_stock_reconciliation_items.reconciliation_id AND sr.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_warehouses', 'erp_item_groups', 'erp_items',
    'erp_stock_ledger_entries', 'erp_stock_reconciliations', 'erp_stock_reconciliation_items'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_warehouses, compliance.erp_item_groups, compliance.erp_items,
  compliance.erp_stock_ledger_entries, compliance.erp_stock_reconciliations, compliance.erp_stock_reconciliation_items
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_warehouses, compliance.erp_item_groups, compliance.erp_items,
  compliance.erp_stock_ledger_entries, compliance.erp_stock_reconciliations, compliance.erp_stock_reconciliation_items
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_warehouses_org_id ON compliance.erp_warehouses(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_warehouses_parent_warehouse_id ON compliance.erp_warehouses(parent_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_erp_item_groups_org_id ON compliance.erp_item_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_item_groups_parent_group_id ON compliance.erp_item_groups(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_erp_items_org_id ON compliance.erp_items(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_items_item_group_id ON compliance.erp_items(item_group_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_ledger_entries_org_id ON compliance.erp_stock_ledger_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_ledger_entries_item_id ON compliance.erp_stock_ledger_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_ledger_entries_warehouse_id ON compliance.erp_stock_ledger_entries(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_reconciliations_org_id ON compliance.erp_stock_reconciliations(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_reconciliations_warehouse_id ON compliance.erp_stock_reconciliations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_reconciliations_created_by_id ON compliance.erp_stock_reconciliations(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_reconciliation_items_reconciliation_id ON compliance.erp_stock_reconciliation_items(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_reconciliation_items_item_id ON compliance.erp_stock_reconciliation_items(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_receipt_items_warehouse_id ON compliance.erp_purchase_receipt_items(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_erp_delivery_note_items_warehouse_id ON compliance.erp_delivery_note_items(warehouse_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_stock', 'Stock & Inventory', 'erp_items', 'erp', 'Stock', false, 'Warehouses, items, stock ledger, stock reconciliation')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_stock'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
