-- Wave B (VERIDIAN Review Framework remediation, "CRM Accounts & Contacts"
-- workstream, 2026-07-17): confirmed via a fresh grep of src/ immediately
-- before this migration was written -- no crm_accounts/crm_contacts table
-- existed at all. crm_leads/crm_opportunities (Wave 41) modeled a
-- prospect/deal as a bare name string with no company-level record
-- (industry/address/lifecycle-stage) and no person-level contact record
-- underneath it, and there was no way to represent a subsidiary/holding
-- company hierarchy. This is deliberately its own bounded identity space,
-- matching this schema's existing precedent of linking separate party-
-- identity spaces (clients / erp_customers / crm_leads) via nullable
-- bridge columns rather than merging them.

CREATE TYPE compliance.crm_account_lifecycle_stage AS ENUM ('prospect', 'active_client', 'dormant', 'churned');

CREATE TABLE IF NOT EXISTS compliance.crm_accounts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  industry text,
  website text,
  billing_line1 text,
  billing_line2 text,
  billing_city text,
  billing_state text,
  billing_postal_code text,
  billing_country text,
  shipping_same_as_billing boolean NOT NULL DEFAULT true,
  shipping_line1 text,
  shipping_line2 text,
  shipping_city text,
  shipping_state text,
  shipping_postal_code text,
  shipping_country text,
  owner_id text REFERENCES compliance.users(id),
  -- Self-referential parent-account link. No FK constraint to itself --
  -- matches this schema's existing bare-text bridge-column convention
  -- (crm_leads.company_id etc.) -- cycle-safety is enforced in the service
  -- layer (wouldCreateCycle()), not the database.
  parent_account_id text,
  lifecycle_stage compliance.crm_account_lifecycle_stage NOT NULL DEFAULT 'prospect',
  company_id text,
  converted_from_lead_id text REFERENCES compliance.crm_leads(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.crm_contacts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  account_id text NOT NULL REFERENCES compliance.crm_accounts(id),
  name text NOT NULL,
  title text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Bridge columns onto the existing crm_leads/crm_opportunities tables --
-- additive, nullable, bare text (no FK), matching company_id's own
-- precedent added in drizzle/0213.
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS account_id text;

ALTER TABLE compliance.crm_accounts ENABLE ROW LEVEL SECURITY;
-- Wave A (2026-07-16/17) established FORCE ROW LEVEL SECURITY as the
-- correct posture for every org-scoped table in this schema (11 tables
-- fixed for exactly this gap). Applying it from the start for these
-- brand-new tables rather than replicating the older wave41
-- enabled-not-forced pattern.
ALTER TABLE compliance.crm_accounts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_accounts FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_accounts ON compliance.crm_accounts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_accounts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_accounts TO service_role;

ALTER TABLE compliance.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.crm_contacts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_contacts FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_contacts ON compliance.crm_contacts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_contacts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_contacts TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_accounts_org_id ON compliance.crm_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_accounts_parent_account_id ON compliance.crm_accounts(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_crm_accounts_lifecycle_stage ON compliance.crm_accounts(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_org_id ON compliance.crm_contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_account_id ON compliance.crm_contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_account_id ON compliance.crm_leads(account_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_account_id ON compliance.crm_opportunities(account_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('crm_accounts', 'CRM Accounts', 'crm_accounts', 'crm', 'TOOLS', true, 'Company-level account record -- industry/address/lifecycle-stage/owner, with optional parent-account hierarchy for subsidiaries'),
  ('crm_contacts', 'CRM Contacts', 'crm_contacts', 'crm', 'TOOLS', true, 'Named person at a CRM account, with a primary-contact flag')
ON CONFLICT (module_key) DO NOTHING;

-- Asset Registry Coverage Check (GAP-UMR-TABLE-COVERAGE): both new tables are
-- real, discoverable platform business records, same class as the sibling
-- crm_leads/crm_opportunities (Priority 8, drizzle/0161) -- registered the
-- same way, not exempted. Column choices match the live
-- asset_registration_config rows for crm_leads/crm_opportunities/clients/
-- erp_customers exactly (checked via Supabase MCP before writing this,
-- not guessed): asset_type 'other' (no closer-fitting enum value for a
-- company/contact master record), org_column org_id, no active_column
-- (neither table has a boolean active flag -- lifecycle_stage is not a
-- simple on/off toggle). crm_accounts gets owner_id as owner_column
-- (assigned rep, same as crm_leads/crm_opportunities); crm_contacts has no
-- owner concept of its own (it belongs to an account), so owner_column is
-- NULL, matching clients/erp_customers' own NULL-owner precedent.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('crm_accounts', 'other', 'name', NULL, NULL, 'org_id', 'owner_id', NULL),
  ('crm_contacts', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL)
ON CONFLICT (source_table) DO NOTHING;

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.crm_accounts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
