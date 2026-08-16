-- Wave 53 (VERI ERP gap-fill, Tier 1 #4): Inventory FIFO valuation engine.
-- erp_stock_ledger_entries.valuation_rate (Wave 49) was a raw stored
-- number with no FIFO layer/queue logic behind it -- this table is that
-- missing layer, modeled on ERPNext's own FIFO-queue-per-item-warehouse
-- approach but as a real relational table (one row per still-unconsumed
-- receipt) rather than a JSON blob column.

CREATE TABLE IF NOT EXISTS compliance.erp_stock_valuation_layers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  warehouse_id text NOT NULL REFERENCES compliance.erp_warehouses(id),
  stock_ledger_entry_id text NOT NULL REFERENCES compliance.erp_stock_ledger_entries(id),
  receipt_date date NOT NULL,
  original_qty numeric NOT NULL,
  remaining_qty numeric NOT NULL,
  rate numeric NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.erp_stock_valuation_layers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_stock_valuation_layers FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_stock_valuation_layers ON compliance.erp_stock_valuation_layers FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_stock_valuation_layers TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_stock_valuation_layers TO service_role;

CREATE INDEX IF NOT EXISTS idx_erp_stock_valuation_layers_org_id ON compliance.erp_stock_valuation_layers(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_valuation_layers_item_warehouse ON compliance.erp_stock_valuation_layers(item_id, warehouse_id, remaining_qty);
CREATE INDEX IF NOT EXISTS idx_erp_stock_valuation_layers_stock_ledger_entry_id ON compliance.erp_stock_valuation_layers(stock_ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_stock_valuation_layers_receipt_date ON compliance.erp_stock_valuation_layers(receipt_date);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_stock_valuation', 'Stock Valuation (FIFO)', 'erp_stock_valuation_layers', 'erp', 'Stock', false, 'FIFO cost layers for accurate COGS and inventory value')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_stock_valuation'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
