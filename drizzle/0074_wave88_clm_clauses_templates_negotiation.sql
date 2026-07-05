-- Wave 88 (Comparison CSV 2 gap analysis: CLM002 "Template Management" +
-- CLM003 "Clause Library" + CLM005 "Negotiation Tracking"). Clause library,
-- contract templates (referencing clauses via an ordered join, not
-- duplicating text), plain token-substitution "generate from template"
-- (erp_contracts.body_text/template_id), and a negotiation-round log
-- mirroring Wave 83's erp_rfq_negotiation_rounds pattern for contracts.

CREATE TABLE IF NOT EXISTS compliance.clm_clauses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  title text NOT NULL,
  category text,
  body_text text NOT NULL,
  risk_level text,
  is_standard boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.clm_contract_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  contract_type text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.clm_template_clauses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  template_id text NOT NULL REFERENCES compliance.clm_contract_templates(id) ON DELETE CASCADE,
  clause_id text NOT NULL REFERENCES compliance.clm_clauses(id),
  position integer NOT NULL,
  is_optional boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS compliance.erp_contract_negotiation_rounds (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  contract_id text NOT NULL REFERENCES compliance.erp_contracts(id),
  round_number integer NOT NULL,
  proposed_value numeric,
  notes text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.erp_contracts ADD COLUMN IF NOT EXISTS template_id text REFERENCES compliance.clm_contract_templates(id);
ALTER TABLE compliance.erp_contracts ADD COLUMN IF NOT EXISTS body_text text;

CREATE INDEX IF NOT EXISTS idx_clm_template_clauses_template_id ON compliance.clm_template_clauses(template_id);
CREATE INDEX IF NOT EXISTS idx_clm_template_clauses_clause_id ON compliance.clm_template_clauses(clause_id);
CREATE INDEX IF NOT EXISTS idx_erp_contract_negotiation_rounds_contract_id ON compliance.erp_contract_negotiation_rounds(contract_id);

ALTER TABLE compliance.clm_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.clm_contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.clm_template_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_contract_negotiation_rounds ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.clm_clauses FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.clm_contract_templates FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- clm_template_clauses has no org_id of its own; RLS scopes via its parent
-- template's org_id (same convention as erp_cycle_count_lines/Wave 87).
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.clm_template_clauses FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.clm_contract_templates t WHERE t.id = clm_template_clauses.template_id AND t.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_contract_negotiation_rounds FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['clm_clauses', 'clm_contract_templates', 'clm_template_clauses', 'erp_contract_negotiation_rounds'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.clm_clauses, compliance.clm_contract_templates, compliance.clm_template_clauses, compliance.erp_contract_negotiation_rounds
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.clm_clauses, compliance.clm_contract_templates, compliance.clm_template_clauses, compliance.erp_contract_negotiation_rounds
  TO service_role;
