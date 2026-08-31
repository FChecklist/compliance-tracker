-- Priority 11 (GAP-D15-REMAINING-TRIGGERS, closing). Real receipt table for
-- Vercel deployment webhook deliveries -- see schema.ts's own header comment
-- on deploymentEvents and src/app/api/webhooks/vercel-deployment/route.ts
-- for the full story. PLATFORM-WIDE by design (no org_id column): a Vercel
-- deployment belongs to this app's own single Vercel project
-- (veridian-compliance-ai), not to any one tenant org -- same posture as
-- Wave 20's module_registry/product_branches (drizzle/0017), which this
-- migration's RLS/GRANT shape mirrors: app_runtime gets read-only SELECT
-- (no route currently needs it, but a future dashboard read might), the
-- webhook route itself writes via the plain `postgres`-role DATABASE_URL
-- client (src/lib/db/index.ts), which -- like every route not yet migrated
-- to withTenantContext -- is the table owner and bypasses RLS row
-- filtering by default; RLS is still enabled here per AGENTS.md Rule 9
-- ("every new table gets real RLS, not just an org_id column"), and
-- service_role keeps its standard full-bypass policy.

CREATE TABLE IF NOT EXISTS compliance.deployment_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  vercel_deployment_id text NOT NULL,
  event_type text NOT NULL,
  project_id text,
  project_name text,
  target text,
  deployment_url text,
  state text,
  signature_verified boolean NOT NULL DEFAULT true,
  received_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_events_vercel_deployment_id ON compliance.deployment_events(vercel_deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_events_event_type ON compliance.deployment_events(event_type);
CREATE INDEX IF NOT EXISTS idx_deployment_events_received_at ON compliance.deployment_events(received_at);

ALTER TABLE compliance.deployment_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_deployment_events ON compliance.deployment_events FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_deployment_events ON compliance.deployment_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON compliance.deployment_events TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.deployment_events TO service_role;
