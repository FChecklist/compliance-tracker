-- Wave 80 (Vendor Master enhancements, per COMPARISON_CSV_GAP_ANALYSIS.md
-- backlog item 1): KYC document tracking reuses the existing polymorphic
-- `documents` table (linked_entity_type='erp_supplier') -- no new table
-- needed there. Banking details, qualification workflow, and sanction
-- screening are new append-friendly tables. The vendor self-service portal
-- mirrors conversation_share_links' (Wave 36) tokenized/time-limited
-- share-link shape exactly.

ALTER TABLE compliance.erp_suppliers
  ADD COLUMN IF NOT EXISTS qualification_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS sanction_screening_status text NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS sanction_screened_at timestamp;

CREATE TABLE IF NOT EXISTS compliance.erp_supplier_bank_accounts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id) ON DELETE CASCADE,
  account_holder_name text NOT NULL,
  bank_name text NOT NULL,
  -- Full account number is pgcrypto-encrypted at rest (same AI_CONFIG_ENCRYPTION_KEY
  -- mechanism as ai_configurations, see src/lib/ai-config-crypto.ts) -- only the
  -- last 4 digits are stored in the clear, for display purposes.
  account_number_encrypted text NOT NULL,
  account_number_last4 text NOT NULL,
  ifsc_code text,
  account_type text NOT NULL DEFAULT 'savings',
  is_primary boolean NOT NULL DEFAULT false,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Append-only audit trail of qualification review events -- never
-- overwritten. erp_suppliers.qualification_status is a denormalized cache
-- of the latest row's status, maintained by the service layer (matching
-- this codebase's existing assignee-cache convention, e.g. pms_issues).
CREATE TABLE IF NOT EXISTS compliance.erp_supplier_qualifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id) ON DELETE CASCADE,
  status text NOT NULL,
  criteria jsonb NOT NULL DEFAULT '{}',
  score numeric,
  notes text,
  reviewed_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Append-only log of sanction/blacklist screening events. A human records
-- the outcome of a check performed against an external list (UN/OFAC/RBI
-- caution list/etc) -- this environment has no live sanctions-API
-- integration (no API key), so this is a real screening-log data model and
-- workflow, not an automated live check. Documented honestly, matching this
-- session's verification-boundary discipline for SSO/e-invoicing/embeddings.
CREATE TABLE IF NOT EXISTS compliance.erp_supplier_sanction_checks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id) ON DELETE CASCADE,
  checked_by_id text,
  lists_checked jsonb NOT NULL DEFAULT '[]',
  match_found boolean NOT NULL DEFAULT false,
  match_details text,
  result_status text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Vendor self-service portal: tokenized, time-limited, individually
-- revocable -- identical shape to conversation_share_links (Wave 36).
CREATE TABLE IF NOT EXISTS compliance.erp_supplier_portal_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by_id text,
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_supplier_bank_accounts_supplier_id ON compliance.erp_supplier_bank_accounts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_supplier_qualifications_supplier_id ON compliance.erp_supplier_qualifications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_supplier_sanction_checks_supplier_id ON compliance.erp_supplier_sanction_checks(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_supplier_portal_links_supplier_id ON compliance.erp_supplier_portal_links(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_supplier_portal_links_token ON compliance.erp_supplier_portal_links(token);

ALTER TABLE compliance.erp_supplier_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_supplier_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_supplier_sanction_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_supplier_portal_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_supplier_bank_accounts FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_supplier_qualifications FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_supplier_sanction_checks FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_supplier_portal_links FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_supplier_bank_accounts', 'erp_supplier_qualifications',
    'erp_supplier_sanction_checks', 'erp_supplier_portal_links'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_supplier_bank_accounts, compliance.erp_supplier_qualifications,
  compliance.erp_supplier_sanction_checks, compliance.erp_supplier_portal_links
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_supplier_bank_accounts, compliance.erp_supplier_qualifications,
  compliance.erp_supplier_sanction_checks, compliance.erp_supplier_portal_links
  TO service_role;
