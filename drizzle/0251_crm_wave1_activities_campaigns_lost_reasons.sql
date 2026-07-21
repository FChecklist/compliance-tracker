-- VERIDIAN CRM Wave 1 (2026-07-21). Closes 3 gaps confirmed against
-- reference-system docs (Zoho/Odoo/Infisuite reverse-engineering repos on
-- this same server -- see docs/crm/fields.md in each): a structured Lost
-- Reason for crm_opportunities (Odoo has a configurable Lost Reasons
-- taxonomy; this schema only had free-text stage='lost'), a crm_activities
-- table for Tasks/Meetings/Calls tied to any CRM record (Zoho has this;
-- this schema had no activity-tracking table at all -- reuses
-- crm_stage_history's own polymorphic entity_type+entity_id pattern,
-- extended from lead/opportunity to also cover account/contact), and a
-- crm_campaigns table (Zoho has this; zero campaign concept existed).
--
-- Migration numbering note: drizzle/meta/_journal.json in this repo is
-- stale (frozen at migration 0000 while 250 real .sql files exist
-- untracked by it) -- `bun run db:generate` against it produces a bogus
-- "create the entire schema from scratch" diff, not a real Wave 1 diff.
-- Hand-written here instead, following the exact CREATE TABLE / RLS /
-- index / module_registry / asset_registration_config conventions of
-- drizzle/0219_wave_b_crm_accounts_contacts.sql (the most recent
-- comparable CRM-table migration) rather than trusting the broken
-- generator. The journal staleness itself is a separate, pre-existing
-- infrastructure gap, disclosed here, not fixed by this migration.

CREATE TABLE IF NOT EXISTS compliance.crm_lost_reasons (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  reason_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.crm_activities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  activity_type text NOT NULL,
  subject text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'not_started',
  priority text NOT NULL DEFAULT 'normal',
  notes text,
  assigned_to_id text REFERENCES compliance.users(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.crm_campaigns (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  campaign_type text,
  status text NOT NULL DEFAULT 'planning',
  start_date date,
  end_date date,
  budgeted_cost numeric,
  actual_cost numeric,
  expected_revenue numeric,
  description text,
  owner_id text REFERENCES compliance.users(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Bridge columns onto the existing crm_opportunities/crm_leads tables --
-- additive, nullable, bare text (no FK), matching company_id/account_id's
-- own precedent (drizzle/0213, drizzle/0219).
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS lost_reason_id text;
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS campaign_id text;

-- RLS: same FORCE ROW LEVEL SECURITY posture as every org-scoped table
-- since Wave A (2026-07-16/17).
ALTER TABLE compliance.crm_lost_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.crm_lost_reasons FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_lost_reasons FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_lost_reasons ON compliance.crm_lost_reasons FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_lost_reasons TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_lost_reasons TO service_role;

ALTER TABLE compliance.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.crm_activities FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_activities FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_activities ON compliance.crm_activities FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_activities TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_activities TO service_role;

ALTER TABLE compliance.crm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.crm_campaigns FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_campaigns FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_campaigns ON compliance.crm_campaigns FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_campaigns TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_campaigns TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_lost_reasons_org_id ON compliance.crm_lost_reasons(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_org_id ON compliance.crm_activities(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_entity ON compliance.crm_activities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_assigned_to_id ON compliance.crm_activities(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_org_id ON compliance.crm_campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_lost_reason_id ON compliance.crm_opportunities(lost_reason_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_campaign_id ON compliance.crm_leads(campaign_id);

-- Asset Registry Coverage Check (GAP-UMR-TABLE-COVERAGE), same precedent as
-- drizzle/0219: crm_activities and crm_campaigns are real, discoverable
-- platform business records, registered the same way as crm_leads/
-- crm_opportunities/crm_accounts/crm_contacts. crm_lost_reasons is
-- deliberately NOT registered here -- it is a small org-configurable
-- picklist (comparable to a status/enum table), not itself a trackable
-- business asset, matching this schema's own precedent of not registering
-- lookup/config tables (e.g. no asset_registration_config row exists for
-- purely enumerable config tables elsewhere in this schema, confirmed via
-- grep before writing this). If that judgment turns out wrong on review,
-- adding it later is a one-row, fully additive follow-up.
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('crm_activities', 'CRM Activities', 'crm_activities', 'crm', 'TOOLS', true, 'Tasks/Meetings/Calls tied to any CRM record (lead/opportunity/account/contact) via a polymorphic entity_type+entity_id link, same pattern as crm_stage_history'),
  ('crm_campaigns', 'CRM Campaigns', 'crm_campaigns', 'crm', 'TOOLS', true, 'Marketing campaign record; crm_leads can be attributed to one via the new campaign_id bridge column')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('crm_activities', 'other', 'subject', NULL, NULL, 'org_id', 'assigned_to_id', NULL),
  ('crm_campaigns', 'other', 'name', NULL, NULL, 'org_id', 'owner_id', NULL)
ON CONFLICT (source_table) DO NOTHING;

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.crm_activities
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.crm_campaigns
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
