-- Applied directly to Supabase project pcrjmlpuqsbocqfwoxod on 2026-07-01 via Supabase MCP.
-- Wave 0: schema.ts already declared `aiConfigurations` (M-04 BYOK) but the table
-- was never actually migrated to the live database -- /api/settings/ai-config was
-- silently falling back to an in-memory stub because of this. This creates the
-- real table so that route (rewritten in this same change) can persist for real.
-- Also adds the org_id / (status, due_date) indexes flagged missing in analysis.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE compliance.ai_provider AS ENUM ('groq','openai','anthropic','google');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.ai_configurations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  provider compliance.ai_provider NOT NULL,
  encrypted_api_key text,
  is_default boolean NOT NULL DEFAULT false,
  use_for_extraction boolean NOT NULL DEFAULT false,
  use_for_qa boolean NOT NULL DEFAULT false,
  use_for_drafting boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

ALTER TABLE compliance.ai_configurations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_ai_configurations ON compliance.ai_configurations FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS compliance_items_org_id_idx ON compliance.compliance_items (org_id);
CREATE INDEX IF NOT EXISTS compliance_items_status_due_date_idx ON compliance.compliance_items (status, due_date);
CREATE INDEX IF NOT EXISTS departments_org_id_idx ON compliance.departments (org_id);
CREATE INDEX IF NOT EXISTS users_org_id_idx ON compliance.users (org_id);
CREATE INDEX IF NOT EXISTS notices_org_id_idx ON compliance.notices (org_id);
CREATE INDEX IF NOT EXISTS challans_org_id_idx ON compliance.challans (org_id);
CREATE INDEX IF NOT EXISTS mcp_access_codes_org_id_idx ON compliance.mcp_access_codes (org_id);
