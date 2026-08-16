-- Priority 21, Layer 2 Workspace Memory (ai-os/priority21_workspace_memory_design.md).
-- One row per export/import of a user's own memvid (.mv2) capsule. NOT
-- applied live -- left for the supervising session per this repo's own
-- established convention (see ai-os/boss/ACTIVE-CLAIMS.yaml's other
-- schema-touching claims, e.g. drizzle/0209-0210).
CREATE TABLE IF NOT EXISTS compliance.workspace_memory_capsule_events (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  direction text NOT NULL,
  storage_object_path text NOT NULL,
  file_size_bytes integer NOT NULL,
  item_counts jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_memory_capsule_events_org_user_idx
  ON compliance.workspace_memory_capsule_events (org_id, user_id);

-- RLS -- mandatory in the same migration per ai-os/CONSTITUTION.yaml's
-- ARCH-03, verbatim template from MASTER_AI_OS_ARCHITECTURE.md (same
-- template drizzle/0197_prompt_cache_metrics.sql used). Org-scoped RLS is
-- the floor here, not the whole story -- application code additionally
-- filters user_id = the acting user, since a capsule is per-user within an
-- org, not just per-org (see schema.ts's comment on this table).
ALTER TABLE compliance.workspace_memory_capsule_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.workspace_memory_capsule_events FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_workspace_memory_capsule_events ON compliance.workspace_memory_capsule_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.workspace_memory_capsule_events TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.workspace_memory_capsule_events TO service_role;
