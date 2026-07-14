-- Prompt & Cache Management Framework, Phase 1 (2026-07-14). Metrics-only
-- table (see schema.ts's promptCacheMetrics comment) -- NOT a cache store,
-- the actual cached content lives on the provider's side.
CREATE TABLE IF NOT EXISTS compliance.prompt_cache_metrics (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  layer_key text NOT NULL,
  fingerprint text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  cache_attempted boolean NOT NULL,
  prompt_tokens integer,
  cache_read_tokens integer,
  cache_creation_tokens integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prompt_cache_metrics_org_fingerprint_idx
  ON compliance.prompt_cache_metrics (org_id, fingerprint);

-- RLS -- mandatory in the same migration per ai-os/CONSTITUTION.yaml's
-- ARCH-03, verbatim template from MASTER_AI_OS_ARCHITECTURE.md.
ALTER TABLE compliance.prompt_cache_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.prompt_cache_metrics FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_prompt_cache_metrics ON compliance.prompt_cache_metrics FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.prompt_cache_metrics TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.prompt_cache_metrics TO service_role;
