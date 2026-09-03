-- R68 Phase 5 (Institutional Memory Graph, embedding spaces), schema half.
--
-- compliance.embeddings and compliance.document_chunk both store
-- vector(1536) embeddings with no record of WHICH model produced a given
-- vector, or what dimensionality that model's space actually has. Verified
-- live on this project (pcrjmlpuqsbocqfwoxod) before writing this migration:
-- every existing row in both tables is currently 1536-dim
-- (SELECT vector_dims(embedding) ... GROUP BY, 2026-09-04 -- embeddings:
-- 838 is_real=false + 143 is_real=true, all 1536; document_chunk: 11
-- is_real=true, all 1536; zero NULL embeddings in either table). The 384-dim
-- reference in this phase's own directive traces to
-- src/lib/browser-execution/transformers-engine.ts (Xenova/all-MiniLM-L6-v2,
-- a browser-only Phase-5-of-a-different-initiative spike model) and
-- src/app/litert-spike-embeddings/ -- neither writes to Postgres at all, so
-- it does not affect either table's real live dimensionality today. `dim` is
-- still stored per-row (not hardcoded to 1536) because storeEmbedding()'s
-- provider chain is not guaranteed to stay single-dimension forever, and a
-- stored, queryable value is strictly safer than an assumption baked into
-- application code.
--
-- Provenance for the backfill (is_real=true rows, "the model that actually
-- produced them" per this phase's own directive): NOT recoverable per-row.
-- generateEmbeddingUncached (src/lib/embeddings.ts) tries OpenRouter
-- (openai/text-embedding-3-small) first, falling back to Groq
-- (nomic-embed-text) only when OpenRouter fails/is unreachable, with no
-- column or log recording which branch actually ran for any historical row.
-- The embeddings.ts source comment claiming "GROQ_API_KEY has never been
-- set in Vercel" is itself STALE/WRONG -- verified live via
-- `vercel env ls production` on this session (2026-09-04): GROQ_API_KEY has
-- been set on veridian-compliance-ai's Production/Preview/Development
-- environments for 56 days, matching this codebase's own
-- veridian_app_secrets memory note (added 2026-07-10). So the Groq
-- fallback was a live, reachable code path for essentially this whole
-- table's history, not dead code -- the two providers cannot be told apart
-- after the fact. Per this phase's own directive ("if genuinely
-- unrecoverable for historical rows, use a clearly-labeled sentinel like
-- 'unknown-legacy' rather than guessing a specific model name"), is_real
-- rows are backfilled as 'unknown-legacy'. is_real=false rows (hash
-- pseudo-vector fallback, hashToVector()) are unambiguous and backfilled as
-- 'hash-pseudo-vector' -- never a real provider/model name, since no
-- embedding model produced them at all.

ALTER TABLE compliance.embeddings
  ADD COLUMN embedding_model text,
  ADD COLUMN dim integer;

ALTER TABLE compliance.document_chunk
  ADD COLUMN embedding_model text,
  ADD COLUMN dim integer;

UPDATE compliance.embeddings
SET
  embedding_model = CASE WHEN is_real THEN 'unknown-legacy' ELSE 'hash-pseudo-vector' END,
  dim = extensions.vector_dims(embedding)
WHERE embedding_model IS NULL;

UPDATE compliance.document_chunk
SET
  embedding_model = CASE WHEN is_real THEN 'unknown-legacy' ELSE 'hash-pseudo-vector' END,
  dim = extensions.vector_dims(embedding)
WHERE embedding_model IS NULL;

ALTER TABLE compliance.embeddings
  ALTER COLUMN embedding_model SET NOT NULL,
  ALTER COLUMN dim SET NOT NULL;

ALTER TABLE compliance.document_chunk
  ALTER COLUMN embedding_model SET NOT NULL,
  ALTER COLUMN dim SET NOT NULL;
