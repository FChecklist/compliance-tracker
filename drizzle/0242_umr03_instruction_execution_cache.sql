-- UMR-03 gap closure (ai-os/CONSTITUTION.yaml, learning_and_umr): "every
-- chat instruction (DMP+DCS+chat) is stored word-wise in the Universal
-- Metadata Registry so a similar future instruction can be answered from
-- what was already learned, not re-derived from scratch." The two real
-- analogs this codebase already had -- compliance.embedding_cache (caches
-- embedding VECTORS for exact-text reuse) and capability-registry-service.
-- ts's findSimilarCapabilities() (matches a CAPABILITY's own description
-- against a query) -- both stop short of this real, distinct mapping:
-- instruction text -> the capability/dynamic-chain it was previously
-- resolved to. See src/lib/services/instruction-execution-cache-service.ts
-- for the reader/writer functions, wired into fde-service.ts::submitFdeRequest.

CREATE TABLE IF NOT EXISTS compliance.instruction_execution_cache (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text, -- nullable = platform-wide entry, same convention as compliance.embeddings.org_id
  instruction_text text NOT NULL,
  content_hash text NOT NULL,
  resolved_capability_type text,
  resolved_capability_id text,
  resolved_label text,
  resolved_params_shape jsonb,
  success_count integer NOT NULL DEFAULT 1,
  last_used_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);
-- embedding vector(1536) added via a second statement -- pgvector columns
-- aren't representable in a single CREATE TABLE alongside Drizzle's own
-- migration-diffing, same reason compliance.embeddings/embedding_cache/
-- assistant_memories all manage their vector column outside the Drizzle
-- schema definition.
ALTER TABLE compliance.instruction_execution_cache ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_instruction_execution_cache_vector_hnsw ON compliance.instruction_execution_cache
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_instruction_execution_cache_org ON compliance.instruction_execution_cache(org_id);
CREATE INDEX IF NOT EXISTS idx_instruction_execution_cache_content_hash ON compliance.instruction_execution_cache(content_hash);

ALTER TABLE compliance.instruction_execution_cache ENABLE ROW LEVEL SECURITY;

-- Same nullable-org "org-scoped OR platform-default" posture as
-- compliance.platform_assets (drizzle/0150) -- app_runtime sees its own
-- org's rows plus every platform-tier (org_id IS NULL) row; service_role
-- bypasses entirely for admin/migration tooling.
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped_or_platform_default ON compliance.instruction_execution_cache FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id() OR org_id IS NULL)
    WITH CHECK (org_id = compliance.current_org_id() OR org_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_instruction_execution_cache ON compliance.instruction_execution_cache FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.instruction_execution_cache TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.instruction_execution_cache TO service_role;
