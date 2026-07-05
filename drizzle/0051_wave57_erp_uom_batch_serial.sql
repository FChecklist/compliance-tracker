-- Wave 57 (VERI ERP gap-fill, Tier 3 #12): Multi-UOM conversion +
-- batch/serial tracking. Items previously had a single free-text UOM with
-- no conversion path, and no batch/expiry or serial tracking at all -- a
-- real blocker for any distribution/trading or regulated-goods client.
-- Batch/serial are traceability metadata on stock movements, not a
-- per-batch FIFO redesign -- valuation continues at the item-warehouse
-- level (see erp-inventory-service.ts).

ALTER TABLE compliance.erp_items ADD COLUMN IF NOT EXISTS has_batch_no boolean NOT NULL DEFAULT false;
ALTER TABLE compliance.erp_items ADD COLUMN IF NOT EXISTS has_serial_no boolean NOT NULL DEFAULT false;

ALTER TABLE compliance.erp_stock_ledger_entries ADD COLUMN IF NOT EXISTS transaction_uom text;
ALTER TABLE compliance.erp_stock_ledger_entries ADD COLUMN IF NOT EXISTS transaction_qty numeric;
ALTER TABLE compliance.erp_stock_ledger_entries ADD COLUMN IF NOT EXISTS batch_id text;
ALTER TABLE compliance.erp_stock_ledger_entries ADD COLUMN IF NOT EXISTS serial_id text;

DO $$ BEGIN
  CREATE TYPE compliance.erp_item_serial_status AS ENUM ('in_stock', 'delivered', 'returned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_item_uom_conversions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  uom text NOT NULL,
  conversion_factor numeric NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_item_batches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  batch_number text NOT NULL,
  manufacturing_date date,
  expiry_date date,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_item_serials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  serial_number text NOT NULL,
  status compliance.erp_item_serial_status NOT NULL DEFAULT 'in_stock',
  warehouse_id text REFERENCES compliance.erp_warehouses(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['erp_item_uom_conversions', 'erp_item_batches', 'erp_item_serials'])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_item_uom_conversions FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_item_batches FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_item_serials FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['erp_item_uom_conversions', 'erp_item_batches', 'erp_item_serials'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_item_uom_conversions, compliance.erp_item_batches, compliance.erp_item_serials TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_item_uom_conversions, compliance.erp_item_batches, compliance.erp_item_serials TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_uom_conv_org_id ON compliance.erp_item_uom_conversions(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_uom_conv_item_id ON compliance.erp_item_uom_conversions(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_item_batches_org_id ON compliance.erp_item_batches(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_item_batches_item_id ON compliance.erp_item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_item_serials_org_id ON compliance.erp_item_serials(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_item_serials_item_id ON compliance.erp_item_serials(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_item_serials_warehouse_id ON compliance.erp_item_serials(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_erp_sle_batch_id ON compliance.erp_stock_ledger_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_erp_sle_serial_id ON compliance.erp_stock_ledger_entries(serial_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_uom_batch_serial', 'Multi-UOM & Batch/Serial Tracking', 'erp_item_uom_conversions', 'erp', 'Stock', false, 'Alternate-UOM conversion factors and batch/expiry/serial number traceability on stock items')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_uom_batch_serial'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
