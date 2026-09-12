-- R80 Part 2 / W-ROUTER P1.2+P1.3 -- the trigram similarity tier's schema.
--
-- pg_trgm is ALREADY installed on this project (verified live via the
-- Supabase MCP's list_extensions before writing this migration: schema
-- "extensions", installed_version "1.6" -- matches R80_PART2_BUILD_PLAN.md
-- section 0(B)'s own finding). CREATE EXTENSION IF NOT EXISTS is still the
-- right statement here, not a no-op left in by accident: it makes a FRESH
-- environment (a new dev machine, CI's replay-from-empty harness) match
-- production, which is the whole point of this file existing as a migration
-- rather than a note in a doc. Additive only, reversible, no ALTER TYPE.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Index for phrase_map's trigram similarity query (phrase-fuzzy.ts's
-- findBestMatch). The build plan's own note applies verbatim: at 186 live
-- rows this index is for later, not for correctness -- added now so a
-- production-scale phrase_map does not need a second migration to become
-- fast, and so EXPLAIN plans on this table are honest from day one.
CREATE INDEX IF NOT EXISTS idx_phrase_map_normalised_phrase_trgm
  ON compliance.phrase_map USING gin (normalised_phrase gin_trgm_ops);

-- The pipeline's own software-vs-AI split reader (P1.3), deliberately
-- separate from platform.ai_routing_audit_log (a different axis -- Mother
-- Router's aiRouterScopeEnum) and from compliance.ai_reduction_snapshots (a
-- different subsystem -- platform.task_capabilities). See schema.ts's
-- comment on pipelineSimilarityMetrics for the full argument against
-- reusing either.
CREATE TABLE IF NOT EXISTS platform.pipeline_similarity_metrics (
  id              text PRIMARY KEY,
  measured_at     timestamp NOT NULL DEFAULT now(),
  label           text NOT NULL,
  sample_size     integer NOT NULL,
  fuzzy_hits      integer NOT NULL,
  model_calls     integer NOT NULL,
  fuzzy_hit_rate  numeric(5,4) NOT NULL,
  note            text
);

-- RLS: append-only from the app's perspective (one row per measurement run,
-- no update path) -- same app_runtime/service_role split as
-- platform.ai_agent_memory (0506) and platform.ai_routing_audit_log. Not
-- org-scoped (this measures the pipeline as a whole, not one tenant), so
-- app_runtime gets a blanket INSERT/SELECT rather than an org_id USING
-- clause -- there is no tenant column to scope by, by design (see
-- schema.ts's comment on pipelineSimilarityMetrics).
ALTER TABLE platform.pipeline_similarity_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_runtime_insert_pipeline_similarity_metrics ON platform.pipeline_similarity_metrics;
CREATE POLICY app_runtime_insert_pipeline_similarity_metrics ON platform.pipeline_similarity_metrics FOR INSERT TO app_runtime WITH CHECK (true);
DROP POLICY IF EXISTS app_runtime_read_pipeline_similarity_metrics ON platform.pipeline_similarity_metrics;
CREATE POLICY app_runtime_read_pipeline_similarity_metrics ON platform.pipeline_similarity_metrics FOR SELECT TO app_runtime USING (true);
DROP POLICY IF EXISTS service_role_bypass_pipeline_similarity_metrics ON platform.pipeline_similarity_metrics;
CREATE POLICY service_role_bypass_pipeline_similarity_metrics ON platform.pipeline_similarity_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
