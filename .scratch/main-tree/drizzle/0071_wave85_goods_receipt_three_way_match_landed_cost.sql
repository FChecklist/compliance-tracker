-- Wave 85 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #6, final backlog item):
-- Goods Receipt three-way-match (PO/GRN/Invoice), landed-cost allocation,
-- putaway confirmation. erp_purchase_receipts/erp_purchase_orders had never
-- had any create/submit service consumer at all (list-only since Wave 49) --
-- this wave also makes the whole PO -> GRN -> Invoice chain genuinely
-- functional, not just the three named enhancements.

-- Note: erp_purchase_invoices.purchase_order_id already exists (added in
-- Wave 49's migration 0043, with an FK to erp_purchase_orders) but has had
-- zero writer until this wave's createPurchaseInvoice update.
ALTER TABLE compliance.erp_purchase_invoice_items ADD COLUMN IF NOT EXISTS purchase_order_item_id text;
ALTER TABLE compliance.erp_purchase_receipt_items ADD COLUMN IF NOT EXISTS rate numeric;
ALTER TABLE compliance.erp_purchase_receipts ADD COLUMN IF NOT EXISTS putaway_status text NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS compliance.erp_landed_cost_vouchers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  purchase_receipt_id text NOT NULL REFERENCES compliance.erp_purchase_receipts(id) ON DELETE CASCADE,
  posting_date date NOT NULL,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_landed_cost_charges (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  voucher_id text NOT NULL REFERENCES compliance.erp_landed_cost_vouchers(id) ON DELETE CASCADE,
  expense_type text NOT NULL,
  amount numeric NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS compliance.erp_landed_cost_allocations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  voucher_id text NOT NULL REFERENCES compliance.erp_landed_cost_vouchers(id) ON DELETE CASCADE,
  receipt_item_id text NOT NULL REFERENCES compliance.erp_purchase_receipt_items(id) ON DELETE CASCADE,
  allocated_amount numeric NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_erp_landed_cost_vouchers_receipt_id ON compliance.erp_landed_cost_vouchers(purchase_receipt_id);
CREATE INDEX IF NOT EXISTS idx_erp_landed_cost_charges_voucher_id ON compliance.erp_landed_cost_charges(voucher_id);
CREATE INDEX IF NOT EXISTS idx_erp_landed_cost_allocations_voucher_id ON compliance.erp_landed_cost_allocations(voucher_id);

ALTER TABLE compliance.erp_landed_cost_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_landed_cost_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_landed_cost_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_landed_cost_vouchers FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_landed_cost_charges FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_landed_cost_allocations FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['erp_landed_cost_vouchers', 'erp_landed_cost_charges', 'erp_landed_cost_allocations'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_landed_cost_vouchers, compliance.erp_landed_cost_charges, compliance.erp_landed_cost_allocations
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_landed_cost_vouchers, compliance.erp_landed_cost_charges, compliance.erp_landed_cost_allocations
  TO service_role;
