-- Wave 69 (e-invoicing/IRN data model, per resilient-tech/india-
-- compliance's e_invoice_log doctype as reference -- GPL-3.0, no code
-- copied): a separate log table, not fields bolted onto Sales Invoice
-- directly. Real IRP submission requires GSP credentials this
-- environment doesn't have; this wave builds and proves the payload
-- generation + log lifecycle, same verification-boundary honesty as
-- Wave 59's SSO.

CREATE TABLE IF NOT EXISTS compliance.erp_e_invoice_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  reference_type text NOT NULL DEFAULT 'sales_invoice',
  reference_id text NOT NULL REFERENCES compliance.erp_sales_invoices(id),
  status text NOT NULL DEFAULT 'draft',
  invoice_data jsonb,
  irn text,
  ack_number text,
  ack_date timestamp,
  signed_invoice text,
  signed_qr_code text,
  is_generated_in_sandbox boolean NOT NULL DEFAULT true,
  is_cancelled boolean NOT NULL DEFAULT false,
  cancelled_at timestamp,
  cancel_reason_code text,
  cancel_remark text,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.erp_sales_invoices ADD COLUMN IF NOT EXISTS irn text;
ALTER TABLE compliance.erp_sales_invoices ADD COLUMN IF NOT EXISTS e_invoice_status text;

CREATE INDEX IF NOT EXISTS idx_erp_e_invoice_logs_org_id ON compliance.erp_e_invoice_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_e_invoice_logs_reference_id ON compliance.erp_e_invoice_logs(reference_id);

ALTER TABLE compliance.erp_e_invoice_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_e_invoice_logs FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_e_invoice_logs ON compliance.erp_e_invoice_logs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_e_invoice_logs TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_e_invoice_logs TO service_role;
