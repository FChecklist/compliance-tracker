-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to embeddings table (the table exists in Drizzle schema without the vector column since Drizzle doesn't support vector type natively)
ALTER TABLE compliance.embeddings ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for similarity search
CREATE INDEX IF NOT EXISTS embeddings_cosine_idx ON compliance.embeddings
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Create index for entity lookups
CREATE INDEX IF NOT EXISTS embeddings_entity_idx ON compliance.embeddings (entity_type, entity_id);