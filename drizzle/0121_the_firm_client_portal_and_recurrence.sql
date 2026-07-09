-- THE FIRM: Client Portal (magic-link, same posture as erp_supplier_portal_links)
-- + recurring engagement automation + engagement budget-vs-actual.
--
-- This table was originally applied live (as 0112) before this migration
-- file and its consuming application code (src/lib/services/firm-client-
-- portal-service.ts, src/app/api/client-portal/*, src/app/client-portal/*)
-- were committed to git. A concurrent gap-closure pass (0117_wave135) found
-- it with zero rows and zero repo references and dropped it as orphaned
-- cruft -- a reasonable call given what was visible at the time. Renumbered
-- to 0121 (past the concurrent session's 0112-0120 range) and reapplied
-- alongside the now-committed consuming code so it won't look orphaned again.

ALTER TABLE compliance.firm_engagements ADD COLUMN IF NOT EXISTS recurrence_type text NOT NULL DEFAULT 'none';
ALTER TABLE compliance.firm_engagements ADD COLUMN IF NOT EXISTS next_occurrence_date date;
ALTER TABLE compliance.firm_engagements ADD COLUMN IF NOT EXISTS budgeted_hours numeric;

ALTER TABLE compliance.firm_engagement_deliverables ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true;
ALTER TABLE compliance.firm_engagement_deliverables ADD COLUMN IF NOT EXISTS submitted_at timestamp;

CREATE TABLE IF NOT EXISTS compliance.firm_client_portal_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  client_id text NOT NULL,
  token text NOT NULL UNIQUE,
  created_by_id text,
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_client_portal_links_client_id ON compliance.firm_client_portal_links(client_id);
CREATE INDEX IF NOT EXISTS idx_firm_client_portal_links_org_id ON compliance.firm_client_portal_links(org_id);
CREATE INDEX IF NOT EXISTS idx_firm_engagements_next_occurrence ON compliance.firm_engagements(next_occurrence_date) WHERE recurrence_type <> 'none';

-- RLS: app_runtime tenant isolation by org_id, service_role bypass -- same
-- pattern every other THE FIRM table already uses (Wave 108 migration).
ALTER TABLE compliance.firm_client_portal_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.firm_client_portal_links FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_firm_client_portal_links ON compliance.firm_client_portal_links FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.firm_client_portal_links TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.firm_client_portal_links TO service_role;

-- This table postdates 0116_wave134_force_rls_all_tables's blanket sweep,
-- so it needs its own FORCE RLS to match that migration's posture.
ALTER TABLE compliance.firm_client_portal_links FORCE ROW LEVEL SECURITY;
