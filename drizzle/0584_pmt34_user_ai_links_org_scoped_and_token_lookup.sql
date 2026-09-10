-- PM-T34 part 2 (2026-09-10). Closes the third table DOD-T4 found:
-- platform.user_ai_links carried only app_runtime_full_access (FOR ALL TO
-- app_runtime USING (true)) -- a live cross-tenant read, confirmed live:
-- 2 rows, 2 distinct org_ids, each visible to the other's tenant context.
--
-- TWO-PART FIX, for two different reasons, both required:
--
-- (a) A plain org-scoped policy, same shape as 0583, so
--     getOrCreateUserAiLink()/revokeUserAiLink() (both wrapped in
--     withTenantContext in ct commit 98ef7b55, same PR as this file) are
--     correctly org-restricted.
--
-- (b) resolveAiLinkToken()'s lookup CANNOT be org-scoped the same way --
--     its entire job is to derive the org FROM an opaque bearer token,
--     with no org context available beforehand. That is a category
--     error, not an unwrapped caller: naively applying an org-scoped
--     policy to this path would deny every MCP tool call on the
--     platform, permanently, for every user. Routed instead through
--     platform.rpc_resolve_ai_link_token(), a narrow SECURITY DEFINER
--     function.
--
-- *** BINDING SEQUENCING REQUIREMENT, READ BEFORE MERGING *** ct commit
-- 98ef7b55 (branch W-ENV/PMT34-cross-tenant-fix) ALREADY calls
-- platform.rpc_resolve_ai_link_token() from resolveAiLinkToken() in
-- src/lib/ai-links/user-links.ts. That function does not exist in the
-- database until THIS FILE is applied. If the TypeScript merges to main
-- before this migration is applied, EVERY MCP TOOL CALL ON THE PLATFORM
-- FAILS with an undefined-function error, for every user, immediately --
-- the mirror-image defect of the regression this entire day was spent
-- on (that one locked a table before checking the callers could reach
-- it; this one repoints the callers before the thing they call exists).
-- THE MIGRATION AND THE TYPESCRIPT MUST LAND IN ONE PULL REQUEST, WITH
-- THIS FILE APPLIED VIA db-migrate.yml BEFORE OR AS PART OF THE MERGE,
-- NEVER AFTER. Do not merge W-ENV/PMT34-cross-tenant-fix on a green CI
-- check alone -- CI cannot see whether this file has been applied to the
-- live database, only whether it typechecks and lints.
--
-- Function satisfies all 4 PM conditions (D48 ruling, 2026-09-10),
-- each dry-run verified live (BEGIN...ROLLBACK against
-- pcrjmlpuqsbocqfwoxod, nothing committed):
--  (a) EXACT EQUALITY ONLY on the token, no LIKE/ILIKE/similarity:
--      WHERE token = p_token. Verified: a truncated/prefix version of a
--      real live token returns 0 rows (prefix_match_count = 0).
--  (b) RETURNS ONLY (org_id, user_id): RETURNS TABLE(org_id text,
--      user_id text), enforced by the RETURNING clause -- not the
--      token, not the row, not revoked_at, nothing else selectable.
--  (c) PRESERVES THE EXACT REVOCATION PREDICATE: status = 'active'
--      (confirmed directly from user-links.ts's own read, NOT
--      revoked_at, which is a companion column set on revoke but not
--      what the read actually gates on). D58 falsification, both
--      states, the IDENTICAL live token: before_revoke_resolves = 1
--      (active token resolves), then revoked exactly as
--      revokeUserAiLink() does (status='revoked', revoked_at=now()),
--      then after_revoke_resolves = 0 on that same token string.
--  (d) THE 4TH CALL SITE FOLDED IN: the fire-and-forget, bare-db,
--      swallowed-.catch() lastUsedAt touch that used to live inside
--      resolveAiLinkToken() (found by reading the function body
--      directly, not visible from the exported function list alone) is
--      now part of this SAME atomic UPDATE...RETURNING -- no separate
--      write, no gap between checking status='active' and touching
--      last_used_at, no bare-db write left on this path at all.
--      Verified: touch_worked = true (last_used_at flips from NULL to
--      non-null as part of the same call that returns the identity).
--
-- Single-statement design (UPDATE ... RETURNING does the lookup, the
-- revocation check, AND the touch in one atomic operation) is stronger
-- than an earlier two-step SELECT-then-UPDATE draft: there is no window
-- between checking status='active' and writing lastUsedAt in which the
-- row could be revoked out from under the check.
--
-- Pre-flight checks done before writing this file, per PM's request
-- (both are true, confirmed live, not assumed):
--  - the `token` column is covered by TWO relevant indexes:
--    user_ai_links_token_key (a plain UNIQUE btree on token) and
--    user_ai_links_token_idx (a partial btree ON token WHERE
--    status='active') -- the second is an exact match for this
--    function's WHERE clause, so the lookup is index-backed, not a
--    full-table scan under a row lock.
--  - neither caller of resolveAiLinkToken() (src/app/api/mcp/[token]/
--    route.ts's GET and POST -- the only two call sites, confirmed by a
--    full src/ tree walk) runs inside a read-only transaction of any
--    kind; both call it as a bare top-level await with no transaction
--    wrapper, so making the lookup a real write does not introduce a
--    read-only-transaction failure mode.
--
-- No free-form parameters (p_token is the only input, used only in an
-- exact-equality WHERE clause). Owned by postgres, pinned search_path
-- matching the other 10 platform.* SECURITY DEFINER functions in this
-- programme, REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO app_runtime only.
ALTER TABLE platform.user_ai_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_runtime_full_access" ON platform.user_ai_links;
CREATE POLICY "app_runtime_org_scoped" ON platform.user_ai_links
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());

CREATE OR REPLACE FUNCTION platform.rpc_resolve_ai_link_token(p_token text)
RETURNS TABLE(org_id text, user_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE platform.user_ai_links
  SET last_used_at = now()
  WHERE token = p_token AND status = 'active'
  RETURNING user_ai_links.org_id, user_ai_links.user_id;
END;
$$;

ALTER FUNCTION platform.rpc_resolve_ai_link_token(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_resolve_ai_link_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.rpc_resolve_ai_link_token(text) TO app_runtime;
