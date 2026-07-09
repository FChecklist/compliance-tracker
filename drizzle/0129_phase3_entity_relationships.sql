-- Phase 3 (Phase3_Design_by_Claude.md, graph store decision): generic
-- typed-edge table for entity-to-entity relationships. Additive, no
-- existing table touched. Zero consumers wired in yet by design -- see
-- design doc for why forcing one now would repeat the "signal into the
-- void" mistake Wave 146 explicitly avoided for the conversation state
-- columns.

CREATE TABLE IF NOT EXISTS compliance.entity_relationships (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  relationship_type text NOT NULL,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_relationships_source ON compliance.entity_relationships(org_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_target ON compliance.entity_relationships(org_id, target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_relationships_edge ON compliance.entity_relationships(org_id, source_type, source_id, target_type, target_id, relationship_type);

ALTER TABLE compliance.entity_relationships ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.entity_relationships FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_entity_relationships ON compliance.entity_relationships FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
