-- Wave 99 (evaluation of alibaba/zvec for VERIDIAN's Vercel/Supabase Edge
-- architecture -- see PLATFORM_STRATEGY.md and the accompanying memory note
-- for the full reasoning). zvec is a native C++ in-process/local-file
-- vector database (no WASM target, no client-server protocol) -- it cannot
-- run inside Vercel Edge Runtime or Supabase Edge Functions (both are V8/
-- Deno isolates with no native-addon or persistent-local-filesystem
-- support), and Vercel's horizontally-scaled, ephemeral-container
-- serverless model has no way to share a local embedded store across
-- concurrent instances. Rejected for this deployment. Real, edge-compatible
-- speedup instead: (1) upgrade compliance.embeddings' vector index from
-- ivfflat to hnsw -- matches the better index type already used on
-- assistant_memories (added ad-hoc during Wave 77, never reconciled here)
-- and avoids ivfflat's need for periodic list-count retraining as this
-- always-growing table scales; (2) a real embedding_cache table so
-- generateEmbedding() can skip the OpenRouter network round-trip entirely
-- for repeated identical query text (the actual latency bottleneck --
-- pgvector search itself is already sub-millisecond at current scale).

DROP INDEX IF EXISTS compliance.idx_embeddings_vector;
CREATE INDEX IF NOT EXISTS idx_embeddings_vector_hnsw ON compliance.embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Exact-match cache keyed on sha256(text) -- looked up by content_hash only,
-- never by vector similarity, so no ANN index is needed here at all (a
-- plain unique btree on content_hash is the only access path).
CREATE TABLE IF NOT EXISTS compliance.embedding_cache (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  content_hash text NOT NULL UNIQUE,
  content text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  last_used_at timestamp NOT NULL DEFAULT now()
);
-- embedding vector(1536) added via a second statement below -- pgvector
-- columns aren't representable in a single CREATE TABLE alongside Drizzle's
-- own migration-diffing (same reason `embeddings`/`assistant_memories`
-- manage their vector column outside the Drizzle schema definition).
ALTER TABLE compliance.embedding_cache ADD COLUMN IF NOT EXISTS embedding vector(1536);

ALTER TABLE compliance.embedding_cache ENABLE ROW LEVEL SECURITY;

-- Global, not org-scoped: the embedding of identical literal text is
-- identical regardless of which org asked for it, and reusing it leaks
-- nothing an org couldn't already infer from the embedding model itself.
-- Same posture as compliance.embeddings' own nullable org_id for
-- platform-wide entries (module registry, etc).
DO $$ BEGIN
  CREATE POLICY app_runtime_read_embedding_cache ON compliance.embedding_cache FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_write_embedding_cache ON compliance.embedding_cache FOR INSERT TO app_runtime WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_update_embedding_cache ON compliance.embedding_cache FOR UPDATE TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_embedding_cache ON compliance.embedding_cache FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON compliance.embedding_cache TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.embedding_cache TO service_role;
