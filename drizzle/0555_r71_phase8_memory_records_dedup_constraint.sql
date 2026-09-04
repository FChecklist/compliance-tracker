-- R71 Phase 8 (U8-02), per R-IMG-17 (cross-tenant dedup absolutely
-- prohibited) and the zero-duplication requirement this store has always
-- stated but never enforced at the DB level (U8-01's gap: memory_records had
-- only its primary key).
--
-- Mirrors embeddings_entity_content_hash_key's composite shape
-- (entity_type, entity_id, content_hash), scoped by scope_type/scope_id/
-- org_id (memory_records' own polymorphic scope model -- scope_id's meaning
-- depends on scope_type, same pattern documented at its own column comment)
-- rather than a global content_hash uniqueness, which would incorrectly
-- reject two different tenants (or two different scopes within one tenant)
-- legitimately recording the same fact.
--
-- A plain multi-column UNIQUE constraint treats every NULL as distinct from
-- every other NULL, so org_id IS NULL (GLOBAL/INDUSTRY scope) and scope_id
-- IS NULL (a scope_type with no specific instance) would each silently defeat
-- deduplication for exactly the rows that most need it. COALESCE normalises
-- both to a stable sentinel, which requires a functional UNIQUE INDEX rather
-- than a plain UNIQUE table constraint (which cannot express expressions).
--
-- effective_from/effective_to are deliberately NOT in the key: a superseded
-- version and its replacement carry the same content_hash by design (an
-- unchanged fact re-affirmed) and must be able to coexist across time, not
-- get treated as a duplicate insert -- see fn_memory_records_append_only_guard()'s
-- own convention of "close this row and INSERT a new one".
CREATE UNIQUE INDEX memory_records_tenant_scoped_content_unique
ON compliance.memory_records (
  COALESCE(org_id, '__global__'),
  scope_type,
  COALESCE(scope_id, ''),
  content_hash
);
