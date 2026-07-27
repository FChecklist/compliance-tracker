-- Gap closure (2026-07-27, DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE):
-- "PMS timesheet -> client invoice". Additive columns mirroring
-- firm_time_entries' billable/hourly_rate_snapshot/invoice_line_item_id
-- trio (drizzle/0086) -- the anti-double-billing mechanism
-- pms-invoice-service.ts's generateInvoiceFromUnbilledProjectTime() relies
-- on: it only ever selects pms_time_entries rows with invoice_item_id IS
-- NULL, and back-fills that column inside the same transaction that
-- creates the erp_sales_invoice + line items, so a re-run for the same
-- project/range always finds zero remaining unbilled rows.
ALTER TABLE compliance.pms_time_entries
  ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hourly_rate_snapshot numeric,
  ADD COLUMN IF NOT EXISTS invoice_item_id text;

ALTER TABLE compliance.pms_time_entries
  ADD CONSTRAINT pms_time_entries_invoice_item_id_fkey FOREIGN KEY (invoice_item_id) REFERENCES compliance.erp_sales_invoice_items(id);

CREATE INDEX IF NOT EXISTS idx_pms_time_entries_unbilled ON compliance.pms_time_entries(org_id, issue_id, billable, invoice_item_id);
