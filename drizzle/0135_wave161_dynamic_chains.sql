-- Wave 161 (VERIDIAN_DMP_DCF_CONSTITUTION.md, "Dynamic Chain as the Primary
-- System Object -- Phase 1"). Additive only: a new dynamic_chains table plus
-- nullable dynamicChainId columns on tasks/conversations. No backfill of
-- historical rows, no existing behavior changed. Reuses the polymorphic-
-- pointer precedent (conversations.contextEntityType/Id) and the
-- selection-path precedent (forgeProjectRequests.selectionPath) rather than
-- inventing a new pattern.

CREATE TABLE IF NOT EXISTS compliance.dynamic_chains (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  mode_pill text NOT NULL,
  path_keys jsonb NOT NULL DEFAULT '[]',
  path_labels jsonb NOT NULL DEFAULT '[]',
  module_ref text,
  description text,
  created_by_id text,
  status text NOT NULL DEFAULT 'approved', -- 'draft' | 'proposed' | 'approved' | 'retired'
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dynamic_chains_org ON compliance.dynamic_chains(org_id, mode_pill, status);

ALTER TABLE compliance.dynamic_chains ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.dynamic_chains FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_dynamic_chains ON compliance.dynamic_chains FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.tasks ADD COLUMN IF NOT EXISTS dynamic_chain_id text;
ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS dynamic_chain_id text;
