-- Wave 45 (VAIOS Layer 1-4 OpenRouter wiring): discovered while testing VERI
-- FDE end-to-end -- the `embedding` vector column referenced throughout
-- embeddings.ts (storeEmbedding/findSimilar) was never actually created on
-- compliance.embeddings, even though pgvector (v0.8.0) is installed and the
-- application code has depended on this column since Wave 43's Capability
-- Registry. Every storeEmbedding() call has been silently failing since
-- inception -- semantic search / duplicate-capability-detection has never
-- actually worked in production. 1536 dimensions matches the hash-based
-- fallback vector's dimension (generateEmbedding()'s actual path today,
-- since GROQ_API_KEY is also absent from Vercel -- a separate, already-
-- documented gap, not fixed in this migration).
ALTER TABLE compliance.embeddings ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON compliance.embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
