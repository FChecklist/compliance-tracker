-- R68 (Institutional Memory Graph) Phase 4 -- the recall ladder, tier 2.
--
-- WHY THIS MIGRATION EXISTS (it was NOT assumed -- it was checked first):
--
-- Phase 4's tier 2 is keyword/full-text recall. The obvious candidate was
-- compliance.document_chunk.search_vector, which genuinely already exists
-- on the live database (pcrjmlpuqsbocqfwoxod) as
--
--   search_vector tsvector GENERATED ALWAYS AS
--     (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED
--
-- indexed by document_chunk_search_vector_gin (GIN). Verified live before
-- writing a line of this file.
--
-- compliance.memory_records, however, has NO tsvector column and no GIN
-- index -- also verified live, against pg_attribute/pg_indexes, not
-- assumed from the repo's migration history. That is a real gap, not a
-- stylistic one, and it is the specific reason this migration exists:
--
--   * Tier 1 (exact) reads memory_records by logical key.
--   * Tier 3 (vector) reads memory records back through
--     compliance.embeddings (entity_type = 'memory_record').
--   * Tier 2 sits BETWEEN them and must search the SAME corpus, or the
--     ladder is incoherent -- a tier-2 "hit" would hand back a document
--     chunk when the caller asked the memory layer a question.
--
-- The load-bearing consequence is Phase 4's own falsifiable degradation
-- test: with no embedding provider configured at all, tiers 1-2 must still
-- return correct answers. Without a tsvector on memory_records there is no
-- keyword path to a MEMORY at all, so a provider-less system could only
-- ever do exact-key lookup -- which is precisely the "works first as
-- software, then with AI" property Phase 4 is supposed to prove. Adding
-- the column is what makes that test able to pass honestly rather than by
-- redefining tier 2 to search a different table.
--
-- DELIBERATELY MIRRORS document_chunk.search_vector EXACTLY (same
-- 'english' regconfig, same COALESCE(content,''), same GENERATED ALWAYS AS
-- ... STORED, same GIN index shape) rather than inventing a second
-- full-text convention for the same platform. Two tsvector columns that
-- tokenise differently would silently rank the same phrase differently
-- depending on which table it landed in.
--
-- A GENERATED column, not a trigger: content is the only input, Postgres
-- maintains it, and there is no write path that can forget to update it.
--
-- INTERACTION WITH PHASE 1'S APPEND-ONLY GUARD (drizzle/0541) -- checked,
-- not hoped: fn_memory_records_append_only_guard() compares
-- to_jsonb(OLD) against to_jsonb(NEW) after deleting the allowed keys
-- (effective_to, superseded_by_id, lifecycle_state, updated_at, metadata).
-- to_jsonb() does include generated columns, so the question is real. It
-- is safe because search_vector is a pure function of `content`, and
-- `content` is NOT in that allowed list -- any UPDATE that could change
-- search_vector is already rejected by the guard for changing content
-- first. On every UPDATE the guard actually permits, content is unchanged,
-- therefore search_vector is unchanged, therefore the two jsonb documents
-- still compare equal. This migration cannot widen what that guard allows.
--
-- NO BACKFILL STATEMENT IS NEEDED: a STORED generated column is computed
-- by Postgres for every existing row as part of the ADD COLUMN table
-- rewrite. (compliance.memory_records currently holds 0 rows live, so the
-- rewrite is empty in practice -- but the column would be correct for
-- existing rows either way, which is why no UPDATE follows.)

ALTER TABLE compliance.memory_records
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS memory_records_search_vector_gin
  ON compliance.memory_records USING gin (search_vector);
--> statement-breakpoint

COMMENT ON COLUMN compliance.memory_records.search_vector IS
  'R68 Phase 4 (recall ladder, tier 2): full-text index over content. Generated ALWAYS AS to_tsvector(''english'', COALESCE(content,'''')) STORED -- byte-identical in configuration to compliance.document_chunk.search_vector so the same phrase tokenises identically in both corpora. Queried via ts_rank in recallMemory()''s tier 2 (src/lib/services/memory-recall-service.ts), which PROPOSES only: per R-CRR-05 ("SIMILAR MAY ONLY PROPOSE. ONLY EXACT MAY EXECUTE."), only tier 1''s exact logical-key match may ever be auto-applied.';
