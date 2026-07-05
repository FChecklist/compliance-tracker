-- Wave 93 (Comparison CSV 3 gap analysis: MDM007 "Duplicate Detection" +
-- MDM008 "Data Quality Scoring"). Duplicate candidates are detected via
-- pg_trgm similarity() on erp_customers.customer_name / erp_suppliers.
-- supplier_name combined with exact gstin/pan_number matches. The merge
-- workflow is deliberately scoped down: it deactivates the loser record and
-- reassigns its own erp_contacts / erp_addresses / erp_supplier_bank_accounts
-- to the survivor, but does NOT rewrite historical invoices/POs/subscriptions
-- still pointing at the merged-away id.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS compliance.mdm_duplicate_candidates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  entity_type text NOT NULL,
  entity_id_a text NOT NULL,
  entity_id_b text NOT NULL,
  match_score numeric NOT NULL,
  match_reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by_id text,
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.mdm_merge_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  entity_type text NOT NULL,
  surviving_entity_id text NOT NULL,
  merged_entity_id text NOT NULL,
  merged_by_id text NOT NULL,
  merged_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mdm_duplicate_candidates_org_id ON compliance.mdm_duplicate_candidates(org_id);
CREATE INDEX IF NOT EXISTS idx_mdm_duplicate_candidates_status ON compliance.mdm_duplicate_candidates(org_id, status);
CREATE INDEX IF NOT EXISTS idx_mdm_merge_log_org_id ON compliance.mdm_merge_log(org_id);

-- Trigram indexes to make similarity() duplicate scans fast on real data volumes.
CREATE INDEX IF NOT EXISTS idx_erp_customers_name_trgm ON compliance.erp_customers USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_erp_suppliers_name_trgm ON compliance.erp_suppliers USING gin (supplier_name gin_trgm_ops);

ALTER TABLE compliance.mdm_duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.mdm_merge_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.mdm_duplicate_candidates FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.mdm_merge_log FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['mdm_duplicate_candidates', 'mdm_merge_log'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.mdm_duplicate_candidates, compliance.mdm_merge_log
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.mdm_duplicate_candidates, compliance.mdm_merge_log
  TO service_role;
