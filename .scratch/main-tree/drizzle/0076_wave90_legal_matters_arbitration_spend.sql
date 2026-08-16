-- Wave 90 (Comparison CSV 2 gap analysis: LEGAL001/002 unified Matter
-- register + LEGAL004 Arbitration & Mediation + LEGAL009 Legal Spend).
-- litigation_matters/ip_portfolio/legal_opinions each lived in their own
-- table with no cross-cutting concept; legal_matters is that register,
-- linked via new nullable matter_id columns on all three (additive columns,
-- not a new join table). Arbitration and legal-spend are genuinely new
-- tracking. LEGAL012 (Evidence Repository) needs no schema change -- reuses
-- the existing `documents` table with linkedEntityType='legal_matter'.

ALTER TABLE compliance.litigation_matters ADD COLUMN IF NOT EXISTS matter_id text;
ALTER TABLE compliance.ip_portfolio ADD COLUMN IF NOT EXISTS matter_id text;
ALTER TABLE compliance.legal_opinions ADD COLUMN IF NOT EXISTS matter_id text;

CREATE TABLE IF NOT EXISTS compliance.legal_matters (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  matter_number integer NOT NULL,
  title text NOT NULL,
  matter_type text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'open',
  description text,
  responsible_user_id text,
  opened_date date NOT NULL,
  closed_date date,
  client_id text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.litigation_matters ADD CONSTRAINT litigation_matters_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES compliance.legal_matters(id);
ALTER TABLE compliance.ip_portfolio ADD CONSTRAINT ip_portfolio_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES compliance.legal_matters(id);
ALTER TABLE compliance.legal_opinions ADD CONSTRAINT legal_opinions_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES compliance.legal_matters(id);

CREATE TABLE IF NOT EXISTS compliance.legal_arbitration_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  matter_id text NOT NULL REFERENCES compliance.legal_matters(id) ON DELETE CASCADE,
  case_title text NOT NULL,
  arbitration_institution text,
  arbitrator text,
  status text NOT NULL DEFAULT 'filed',
  filing_date date,
  award_date date,
  claim_amount numeric,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.legal_spend_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  matter_id text NOT NULL REFERENCES compliance.legal_matters(id) ON DELETE CASCADE,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'legal_fees',
  amount numeric NOT NULL,
  spend_date date NOT NULL,
  vendor_id text REFERENCES compliance.legal_vendors(id),
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_litigation_matters_matter_id ON compliance.litigation_matters(matter_id);
CREATE INDEX IF NOT EXISTS idx_ip_portfolio_matter_id ON compliance.ip_portfolio(matter_id);
CREATE INDEX IF NOT EXISTS idx_legal_opinions_matter_id ON compliance.legal_opinions(matter_id);
CREATE INDEX IF NOT EXISTS idx_legal_arbitration_cases_matter_id ON compliance.legal_arbitration_cases(matter_id);
CREATE INDEX IF NOT EXISTS idx_legal_spend_entries_matter_id ON compliance.legal_spend_entries(matter_id);

ALTER TABLE compliance.legal_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.legal_arbitration_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.legal_spend_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.legal_matters FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- legal_arbitration_cases/legal_spend_entries have no org_id of their own;
-- RLS scopes via their parent matter (Wave 87/88/89 convention).
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.legal_arbitration_cases FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.legal_matters m WHERE m.id = legal_arbitration_cases.matter_id AND m.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.legal_spend_entries FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.legal_matters m WHERE m.id = legal_spend_entries.matter_id AND m.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['legal_matters', 'legal_arbitration_cases', 'legal_spend_entries'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.legal_matters, compliance.legal_arbitration_cases, compliance.legal_spend_entries
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.legal_matters, compliance.legal_arbitration_cases, compliance.legal_spend_entries
  TO service_role;
