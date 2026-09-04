-- R71 Phase 10 (U10-02): quarantine the 143 unknown-legacy embedding rows.
-- Never deleted (GU-10), never re-embedded (GU-09) -- excluded from all
-- future comparison only. Their real per-row provider provenance is not
-- recoverable (R68 Phase 5's own migration note: generateEmbeddingUncached
-- tried OpenRouter then Groq with no column/log recording which branch ran),
-- so 'unknown-legacy' is an honest label, not a real model identity, and a
-- vector compared against it would be comparing against an unknown space.
ALTER TABLE compliance.embeddings
  ADD COLUMN quarantined boolean NOT NULL DEFAULT false;

UPDATE compliance.embeddings
SET quarantined = true
WHERE embedding_model = 'unknown-legacy';
