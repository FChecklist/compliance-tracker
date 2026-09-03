-- compliance.embeddings had a GLOBAL UNIQUE(content_hash) constraint, which
-- contradicts storeEmbedding()'s own dedup logic (checked per
-- entity_type + entity_id + content_hash, not content_hash alone). Two
-- different entities that happen to share identical content text (e.g. two
-- BOQ line items with the same generic description in different projects)
-- would collide on INSERT with a 23505 unique-violation -- this is a real
-- defect that would silently break production embedding writes any time
-- that happened, not just a backfill-script problem. Found running the
-- GraphRAG embeddings backfill script's --execute path for real, 2026-09-03.
--
-- Safe against existing data by construction: every one of the pre-existing
-- 143 rows was written under the OLD, STRICTER global-uniqueness constraint,
-- so composite uniqueness (a weaker condition) is automatically satisfied --
-- no cleanup/dedup pass needed before this migration.
ALTER TABLE compliance.embeddings DROP CONSTRAINT embeddings_content_hash_key;
ALTER TABLE compliance.embeddings ADD CONSTRAINT embeddings_entity_content_hash_key UNIQUE (entity_type, entity_id, content_hash);
