-- GAP-CONNECTOR-DIGITAL-TWIN / D26.B4.S1 (Business Digital Twin, first real
-- schema slice). Connectors.docx proposed a 16-field per-document canonical
-- representation for every connected source; this is a genuinely useful
-- SUBSET (document type/source/title/lastModified/ownerId/businessObjectType
-- plus a jsonb overflow for source-specific extras), not all 16 fields at
-- once -- see src/lib/services/connector-data-service.ts's own header for
-- the rationale, and src/lib/db/schema.ts's connectorDocuments comment for
-- why the fields chosen are the ones an actual data pull can honestly
-- populate today. Each row is written by connector-data-service.ts's
-- listRecentGmailMessages()/listRecentDriveFiles() -- the first code in this
-- codebase that pulls real data (not just OAuth connection status) through
-- a connected Composio toolkit (GAP-CONNECTOR-DATA / D26.B2.S1).
--
-- RLS follows the same tenant-isolation + service-role-bypass pattern as
-- every other new table (AGENTS.md Rule 9 / 0146_org_join_codes.sql).
--
-- NOTE (per this session's operating constraints): this migration has NOT
-- been applied against the live Supabase database -- the sandbox this was
-- authored in cannot reach the Supabase pooler. The Super Boss must apply
-- this via the Supabase MCP after the PR merges, same as every other
-- migration file in this directory added by an agent without live DB access
-- this session.

CREATE TABLE IF NOT EXISTS compliance.connector_documents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text NOT NULL,
  toolkit_slug text NOT NULL,
  business_object_type text NOT NULL,
  external_id text NOT NULL,
  title text,
  source_url text,
  owner_id text,
  last_modified_at timestamp,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- One canonical row per (org, source connector, source item) -- the target
-- of connector-data-store.ts's upsertConnectorDocument() onConflictDoUpdate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_documents_org_toolkit_external
  ON compliance.connector_documents(org_id, toolkit_slug, external_id);

CREATE INDEX IF NOT EXISTS idx_connector_documents_org ON compliance.connector_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_connector_documents_user ON compliance.connector_documents(user_id);

ALTER TABLE compliance.connector_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.connector_documents FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_connector_documents ON compliance.connector_documents FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.connector_documents TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.connector_documents TO service_role;

-- Priority 9 verification fix: connector_documents is a real, discoverable
-- platform asset (a document representation) -- register it onto the
-- generic auto-registration trigger from drizzle/0152, same as every other
-- document-shaped table, rather than leaving it exempted.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('connector_documents', 'document', 'title', NULL, 'toolkit_slug', 'org_id', 'user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.connector_documents
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
