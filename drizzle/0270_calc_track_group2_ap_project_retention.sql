-- Calculation-track engine build/extend, Group 2 (AP) schema additions.
-- Three real, confirmed-absent columns needed to close MM-004 (project/WBS
-- dimension on purchase orders), FI-AP-005 (early-payment discount terms),
-- and FI-AP-007 (subcontractor retention withheld) per sap_mapping.sqlite's
-- gap_notes -- see PROGRESS.md Group 2 for the full rationale. All three are
-- additive/nullable-or-zero-defaulted, so every existing row is unaffected.

ALTER TABLE compliance.erp_purchase_orders
  ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE compliance.erp_suppliers
  ADD COLUMN IF NOT EXISTS early_payment_discount_percent numeric,
  ADD COLUMN IF NOT EXISTS early_payment_discount_days integer;

ALTER TABLE compliance.erp_purchase_invoices
  ADD COLUMN IF NOT EXISTS retention_percent numeric NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS retention_amount numeric NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS net_payable numeric NOT NULL DEFAULT '0';

-- Backfill net_payable for any pre-existing rows (retention_percent=0 for
-- all of them, so net_payable = grand_total, matching the old
-- outstandingAmount-from-grandTotal behavior exactly).
UPDATE compliance.erp_purchase_invoices SET net_payable = grand_total WHERE net_payable = '0';
