-- Wave 41: VERIDIAN CRM (PLATFORM_STRATEGY.md §20). Twenty (already
-- rejected in §17.7) and SuiteCRM (AGPL-3.0 PHP monolith) evaluated and
-- rejected as software. Deliberately narrow: completes the existing
-- Wave-1 Clients feature with a lead-to-client pipeline, gated identically
-- (accountType != 'company'). Activity tracking reuses the existing
-- polymorphic contextEntityType/contextEntityId on conversations/
-- veriMeetings rather than a third parallel activity-log table.

CREATE TABLE IF NOT EXISTS compliance.crm_leads (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  contact_email text,
  contact_phone text,
  source text,
  status text NOT NULL DEFAULT 'new',
  owner_id text REFERENCES compliance.users(id),
  converted_client_id text REFERENCES compliance.clients(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.crm_opportunities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  lead_id text REFERENCES compliance.crm_leads(id),
  client_id text REFERENCES compliance.clients(id),
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'prospecting',
  estimated_value numeric,
  expected_close_date date,
  owner_id text REFERENCES compliance.users(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.crm_leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_leads FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_leads ON compliance.crm_leads FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_leads TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_leads TO service_role;

ALTER TABLE compliance.crm_opportunities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_opportunities FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_opportunities ON compliance.crm_opportunities FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_opportunities TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_opportunities TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_leads_org_id ON compliance.crm_leads(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON compliance.crm_leads(status);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_org_id ON compliance.crm_opportunities(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_lead_id ON compliance.crm_opportunities(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_client_id ON compliance.crm_opportunities(client_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('crm_leads', 'CRM Leads', 'crm_leads', 'crm', 'TOOLS', true, 'Prospect organisations not yet a client, with a status pipeline and one-click convert-to-client'),
  ('crm_opportunities', 'CRM Opportunities', 'crm_opportunities', 'crm', 'TOOLS', true, 'Potential new engagements linked to a lead or an existing client, with stage/value/close-date tracking')
ON CONFLICT (module_key) DO NOTHING;
