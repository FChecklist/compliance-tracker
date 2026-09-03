-- R67 Part B / R68 prep: compliance.embeddings' RLS policy had no is_platform_scope
-- branch, unlike platform.graph_node/graph_edge's own working pattern. Under
-- app_runtime (the real role DATABASE_URL/APP_RUNTIME_DATABASE_URL connect as),
-- org_id = current_org_id() is NULL when no tenant context is set, and NULL = NULL
-- is never TRUE in Postgres -- so even a platform-scope row (org_id IS NULL, by
-- storeEmbedding()'s own design) was rejected by RLS on write, and never returned
-- on read, regardless of context. Root-caused 2026-09-03 while building the
-- GraphRAG embeddings backfill script, independently re-confirmed by the R68 IMG
-- study (recorded there as img_spec IMG-021).
--
-- Mirrors platform.graph_node/graph_edge's already-proven pattern: OR in an
-- explicit is_platform_scope check, reusing the column compliance.embeddings
-- already has for exactly this purpose (CRR-019) rather than introducing a new
-- sentinel function.
ALTER POLICY app_runtime_tenant_isolation ON compliance.embeddings
  USING (org_id = compliance.current_org_id() OR is_platform_scope = true)
  WITH CHECK (org_id = compliance.current_org_id() OR is_platform_scope = true);
