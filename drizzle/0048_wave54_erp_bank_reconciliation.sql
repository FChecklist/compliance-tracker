-- Wave 54 (VERI ERP gap-fill, Tier 3 #9): Bank Statement Import &
-- Reconciliation. Reuses this codebase's own existing generic file
-- parser (CSV/Excel/PDF) rather than adding a new MT940 dependency, per
-- VAIOS_ARCHITECTURE_STRATEGY.md's finding that Indian banks
-- overwhelmingly export CSV/Excel statements.

DO $$ BEGIN
  CREATE TYPE compliance.erp_bank_reconciliation_status AS ENUM ('unmatched', 'matched', 'ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_bank_statement_imports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  bank_account_id text NOT NULL REFERENCES compliance.erp_bank_accounts(id),
  file_name text NOT NULL,
  total_lines integer NOT NULL DEFAULT 0,
  imported_by_id text REFERENCES compliance.users(id),
  imported_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_bank_statement_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  import_id text NOT NULL REFERENCES compliance.erp_bank_statement_imports(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  description text,
  reference_no text,
  debit_amount numeric NOT NULL DEFAULT 0,
  credit_amount numeric NOT NULL DEFAULT 0,
  status compliance.erp_bank_reconciliation_status NOT NULL DEFAULT 'unmatched',
  matched_journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.erp_bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_bank_statement_lines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_bank_statement_imports FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_bank_statement_lines FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_bank_statement_imports ON compliance.erp_bank_statement_imports FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_bank_statement_lines ON compliance.erp_bank_statement_lines FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_bank_statement_imports, compliance.erp_bank_statement_lines TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_bank_statement_imports, compliance.erp_bank_statement_lines TO service_role;

CREATE INDEX IF NOT EXISTS idx_erp_bsi_org_id ON compliance.erp_bank_statement_imports(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_bsi_bank_account_id ON compliance.erp_bank_statement_imports(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_erp_bsi_imported_by_id ON compliance.erp_bank_statement_imports(imported_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_bsl_org_id ON compliance.erp_bank_statement_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_bsl_import_id ON compliance.erp_bank_statement_lines(import_id);
CREATE INDEX IF NOT EXISTS idx_erp_bsl_matched_je_id ON compliance.erp_bank_statement_lines(matched_journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_bsl_status ON compliance.erp_bank_statement_lines(org_id, status);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_bank_reconciliation', 'Bank Reconciliation', 'erp_bank_statement_imports', 'erp', 'Accounting', false, 'Bank statement import (CSV/Excel) and reconciliation against journal entries')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_bank_reconciliation'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
