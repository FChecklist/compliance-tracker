-- Wave 67 (multi-entity/consolidation, per ERPNext's Company doctype as
-- reference -- read-only, GPL-3.0, no code copied): a Company is a legal
-- entity WITHIN an org's ERP, distinct from compliance.organisations
-- (the VERIDIAN tenant itself). Chart of accounts stays SHARED across an
-- org's companies (not cloned per-company); consolidation is computed at
-- report-runtime by walking this tree and aggregating erp_journal_entries
-- of every company in the group -- no stored "group GL", matching
-- ERPNext's own approach.

CREATE TABLE IF NOT EXISTS compliance.erp_companies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  company_name text NOT NULL,
  abbr text,
  parent_company_id text REFERENCES compliance.erp_companies(id),
  is_group boolean NOT NULL DEFAULT false,
  default_currency_id text REFERENCES compliance.erp_currencies(id),
  country text,
  date_of_incorporation date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.erp_journal_entries ADD COLUMN IF NOT EXISTS company_id text REFERENCES compliance.erp_companies(id);
ALTER TABLE compliance.erp_sales_invoices ADD COLUMN IF NOT EXISTS company_id text REFERENCES compliance.erp_companies(id);
ALTER TABLE compliance.erp_purchase_invoices ADD COLUMN IF NOT EXISTS company_id text REFERENCES compliance.erp_companies(id);

CREATE INDEX IF NOT EXISTS idx_erp_companies_org_id ON compliance.erp_companies(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_companies_parent_company_id ON compliance.erp_companies(parent_company_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_entries_company_id ON compliance.erp_journal_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_erp_sales_invoices_company_id ON compliance.erp_sales_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_erp_purchase_invoices_company_id ON compliance.erp_purchase_invoices(company_id);

ALTER TABLE compliance.erp_companies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_companies FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_companies ON compliance.erp_companies FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_companies TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_companies TO service_role;
