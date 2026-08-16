-- GST Verification & Reconciliation Engine (2026-07-08).
-- Deterministic import -> validate -> reconcile -> file pipeline for CAs.
-- Studied resilient-tech/india-compliance's GSTR-1/3B JSON shape and 2A/2B
-- reconciliation approach as reference (GPL-3.0 -- no code copied). AI only
-- touches gst_ai_review_reports; every other table is pure deterministic data.

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.gst_source_type AS ENUM ('excel_generic', 'csv_generic', 'tally_xml', 'busy', 'zoho_books');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.gst_invoice_direction AS ENUM ('sales', 'purchase', 'gstr2b');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.gst_import_batch_status AS ENUM ('processing', 'staged', 'confirmed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.gst_finding_severity AS ENUM ('error', 'warning', 'info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.gst_match_type AS ENUM ('exact', 'probable', 'mismatch', 'missing_in_2b', 'missing_in_books');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.gst_return_type AS ENUM ('gstr1', 'gstr3b');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.gst_return_status AS ENUM ('draft', 'generated', 'filed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.gst_import_batches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text,
  source_type compliance.gst_source_type NOT NULL,
  direction compliance.gst_invoice_direction NOT NULL,
  period text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes integer,
  status compliance.gst_import_batch_status NOT NULL DEFAULT 'processing',
  total_rows integer,
  staged_count integer,
  confirmed_count integer,
  error_message text,
  uploaded_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  confirmed_at timestamp,
  cancelled_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.gst_source_profiles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text,
  source_type compliance.gst_source_type NOT NULL,
  name text NOT NULL DEFAULT 'Default',
  column_mapping jsonb NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.gst_import_staging_rows (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id text NOT NULL REFERENCES compliance.gst_import_batches(id) ON DELETE CASCADE,
  source_row integer,
  raw_data jsonb NOT NULL,
  mapped_data jsonb NOT NULL,
  mapping_confidence numeric,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.gst_canonical_invoices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text,
  batch_id text,
  direction compliance.gst_invoice_direction NOT NULL,
  period text NOT NULL,
  source_type compliance.gst_source_type NOT NULL,
  counterparty_gstin text,
  counterparty_name text,
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  place_of_supply text,
  invoice_type text NOT NULL DEFAULT 'b2b',
  taxable_value numeric NOT NULL DEFAULT 0,
  cgst_amount numeric NOT NULL DEFAULT 0,
  sgst_amount numeric NOT NULL DEFAULT 0,
  igst_amount numeric NOT NULL DEFAULT 0,
  cess_amount numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.gst_canonical_invoice_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id text NOT NULL REFERENCES compliance.gst_canonical_invoices(id) ON DELETE CASCADE,
  hsn_sac_code text,
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  taxable_value numeric NOT NULL DEFAULT 0,
  gst_rate_percent numeric NOT NULL DEFAULT 0,
  cgst_amount numeric NOT NULL DEFAULT 0,
  sgst_amount numeric NOT NULL DEFAULT 0,
  igst_amount numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance.gst_gstin_master (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  gstin text NOT NULL UNIQUE,
  checksum_valid boolean NOT NULL,
  legal_name text,
  trade_name text,
  state_code text,
  lookup_status text,
  last_checked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.gst_hsn_master (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  hsn_sac_code text NOT NULL UNIQUE,
  description text,
  default_gst_rate_percent numeric,
  is_service boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.gst_validation_findings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  batch_id text,
  invoice_id text,
  rule_code text NOT NULL,
  severity compliance.gst_finding_severity NOT NULL,
  message text NOT NULL,
  suggested_fix text,
  created_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.gst_reconciliation_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text,
  period text NOT NULL,
  purchase_batch_id text,
  gstr2b_batch_id text,
  status text NOT NULL DEFAULT 'running',
  total_purchase_rows integer,
  total_2b_rows integer,
  exact_matches integer,
  probable_matches integer,
  mismatches integer,
  missing_in_2b integer,
  missing_in_books integer,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.gst_reconciliation_matches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text NOT NULL REFERENCES compliance.gst_reconciliation_runs(id) ON DELETE CASCADE,
  purchase_invoice_id text,
  gstr2b_invoice_id text,
  match_type compliance.gst_match_type NOT NULL,
  confidence_score numeric,
  delta_amount numeric,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.gst_return_periods (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text,
  period text NOT NULL,
  gstin text NOT NULL,
  return_type compliance.gst_return_type NOT NULL,
  status compliance.gst_return_status NOT NULL DEFAULT 'draft',
  generated_json jsonb,
  summary jsonb,
  generated_by_id text,
  generated_at timestamp,
  filed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.gst_ai_review_reports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  return_period_id text NOT NULL REFERENCES compliance.gst_return_periods(id) ON DELETE CASCADE,
  report_text text NOT NULL,
  risk_flags jsonb NOT NULL DEFAULT '[]',
  provider text,
  model text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_gst_import_batches_org_id ON compliance.gst_import_batches(org_id);
CREATE INDEX IF NOT EXISTS idx_gst_import_batches_period ON compliance.gst_import_batches(period);
CREATE INDEX IF NOT EXISTS idx_gst_source_profiles_org_id ON compliance.gst_source_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_gst_import_staging_rows_batch_id ON compliance.gst_import_staging_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_gst_canonical_invoices_org_id ON compliance.gst_canonical_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_gst_canonical_invoices_period ON compliance.gst_canonical_invoices(period);
CREATE INDEX IF NOT EXISTS idx_gst_canonical_invoices_batch_id ON compliance.gst_canonical_invoices(batch_id);
CREATE INDEX IF NOT EXISTS idx_gst_canonical_invoices_counterparty_gstin ON compliance.gst_canonical_invoices(counterparty_gstin);
CREATE INDEX IF NOT EXISTS idx_gst_canonical_invoices_invoice_number ON compliance.gst_canonical_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_gst_canonical_invoice_items_invoice_id ON compliance.gst_canonical_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_gst_validation_findings_org_id ON compliance.gst_validation_findings(org_id);
CREATE INDEX IF NOT EXISTS idx_gst_validation_findings_batch_id ON compliance.gst_validation_findings(batch_id);
CREATE INDEX IF NOT EXISTS idx_gst_reconciliation_runs_org_id ON compliance.gst_reconciliation_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_gst_reconciliation_matches_run_id ON compliance.gst_reconciliation_matches(run_id);
CREATE INDEX IF NOT EXISTS idx_gst_return_periods_org_id ON compliance.gst_return_periods(org_id);
CREATE INDEX IF NOT EXISTS idx_gst_ai_review_reports_return_period_id ON compliance.gst_ai_review_reports(return_period_id);

-- ============================================================
-- 4. RLS -- app_runtime tenant isolation by org_id, service_role bypass
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gst_import_batches','gst_source_profiles','gst_canonical_invoices',
    'gst_validation_findings','gst_reconciliation_runs','gst_return_periods','gst_ai_review_reports']
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_tenant_isolation ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO app_runtime', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO service_role', t);
  END LOOP;
END $$;

-- Child tables scoped via their parent's org_id (same join-through pattern as
-- client_entities in 0005_wave7): no org_id column of their own.
ALTER TABLE compliance.gst_import_staging_rows ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.gst_import_staging_rows FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.gst_import_batches b WHERE b.id = gst_import_staging_rows.batch_id AND b.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_gst_import_staging_rows ON compliance.gst_import_staging_rows FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_import_staging_rows TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_import_staging_rows TO service_role;

ALTER TABLE compliance.gst_canonical_invoice_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.gst_canonical_invoice_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.gst_canonical_invoices i WHERE i.id = gst_canonical_invoice_items.invoice_id AND i.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_gst_canonical_invoice_items ON compliance.gst_canonical_invoice_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_canonical_invoice_items TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_canonical_invoice_items TO service_role;

ALTER TABLE compliance.gst_reconciliation_matches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.gst_reconciliation_matches FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.gst_reconciliation_runs r WHERE r.id = gst_reconciliation_matches.run_id AND r.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_gst_reconciliation_matches ON compliance.gst_reconciliation_matches FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_reconciliation_matches TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_reconciliation_matches TO service_role;

-- Platform-governed reference tables (GSTIN/HSN master) -- read-only to every
-- tenant, written only by service_role (background refresh jobs / seed).
ALTER TABLE compliance.gst_gstin_master ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_all ON compliance.gst_gstin_master FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_gst_gstin_master ON compliance.gst_gstin_master FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE ON compliance.gst_gstin_master TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_gstin_master TO service_role;

ALTER TABLE compliance.gst_hsn_master ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_all ON compliance.gst_hsn_master FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_gst_hsn_master ON compliance.gst_hsn_master FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.gst_hsn_master TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.gst_hsn_master TO service_role;

-- ============================================================
-- 5. Seed: starter HSN/SAC master (common codes, not exhaustive)
-- ============================================================
INSERT INTO compliance.gst_hsn_master (hsn_sac_code, description, default_gst_rate_percent, is_service) VALUES
  ('998311', 'Management consulting services', 18, true),
  ('998313', 'Information technology consulting services', 18, true),
  ('998221', 'Legal advisory and representation services', 18, true),
  ('998222', 'Legal documentation and certification services', 18, true),
  ('998231', 'Accounting, bookkeeping and auditing services', 18, true),
  ('997212', 'Rental or leasing of commercial property', 18, true),
  ('998719', 'Maintenance and repair services', 18, true),
  ('998596', 'Advertising services', 18, true),
  ('998599', 'Other professional/technical/business services', 18, true),
  ('847130', 'Portable automatic data processing machines', 18, false),
  ('851712', 'Mobile phones', 18, false),
  ('940360', 'Wooden furniture', 18, false),
  ('482020', 'Exercise books, notebooks', 12, false),
  ('490110', 'Printed books', 0, false),
  ('100199', 'Wheat and meslin, other than seed', 0, false)
ON CONFLICT (hsn_sac_code) DO NOTHING;

-- ============================================================
-- 6. Prompt template for the AI review report (Prompt OS convention -- see
-- prompt-os-resolver.ts, every AI call site resolves its system prompt from
-- here rather than a hardcoded string).
-- ============================================================
INSERT INTO compliance.prompt_templates (id, template_key, display_name, description)
VALUES (gen_random_uuid()::text, 'gst.ai_review_report', 'GST Return AI Review Report',
  'Generates a plain-language risk report from deterministic GST validation findings and reconciliation results, for a CA to review before filing.')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (id, prompt_template_id, version, content, label, is_active)
SELECT gen_random_uuid()::text, pt.id, 1,
$PROMPT$You are a GST compliance reviewer helping a Chartered Accountant sanity-check a return before filing. You will be given, as JSON: the return period, validation findings (from a deterministic rules engine -- GSTIN checksum failures, duplicate invoices, invoice number gaps, unknown HSN/SAC codes, tax calculation mismatches, interstate/intrastate split errors), and reconciliation results (GSTR-2B vs purchase register matches, mismatches, and missing invoices with their amounts).

Do not recompute or contradict any number given to you -- treat every figure in the input as ground truth from the deterministic engine. Your job is only to explain, prioritise, and recommend, in plain language a CA can scan quickly:

1. Start with a one-line overall risk verdict (low/medium/high) and why.
2. List the top issues ranked by materiality (rupee amount at stake or filing-blocking severity), not by the order they appear in the input.
3. For each top issue, give a short, concrete suggested action (e.g. "Contact supplier X to reissue invoice with correct GSTIN" not "review the discrepancy").
4. Call out anything that would block filing entirely (format errors, missing mandatory fields) separately from ITC-risk items (2B mismatches).
5. Keep the whole report under 400 words. No preamble, no disclaimers about being an AI.

Respond with ONLY valid JSON: { "verdict": "low"|"medium"|"high", "summary": string, "topIssues": [{ "title": string, "amountAtStake": number|null, "recommendation": string }], "reportText": string }. reportText should be the full formatted report as markdown; the other fields are structured extracts of the same content for the UI.$PROMPT$,
  'production', true
FROM compliance.prompt_templates pt WHERE pt.template_key = 'gst.ai_review_report'
ON CONFLICT DO NOTHING;
