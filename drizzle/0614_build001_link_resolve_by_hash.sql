-- PROJEXA-BUILD-001 U-18 stage B (Phase 2, register rows BR-210, BR-288):
-- the preauth lookup that can resolve a project-scoped link. Additive: one new
-- SECURITY DEFINER function. No table, row, policy or existing function is
-- changed by this file.
--
-- WHAT
--   platform.rpc_resolve_ai_link_scoped(p_token text), the sibling of
--   platform.rpc_resolve_ai_link_token (drizzle/0584), which stays exactly as
--   it is. It resolves one ACTIVE, UNEXPIRED platform.user_ai_links row, in
--   one of two ways, each bound to its own product:
--     product = 'veridian' AND token = p_token
--       the VERIDIAN chat link, matched exactly as 0584 matches it (0613's
--       CHECK user_ai_links_projexa_shape keeps every projexa row's token NULL,
--       so this arm can never reach a projexa row);
--     product = 'projexa' AND token_hash = sha256 hex of p_token
--       a PROJEXA work link, which stores no plaintext (spec section 10.4:
--       encode(sha256(convert_to(token,'UTF8')),'hex'), the DPDP link rule of
--       drizzle/0607/0610). pg_catalog.sha256 is built in since Postgres 11,
--       so no pgcrypto and no extensions schema on the pinned search_path.
--   It returns id, org_id, user_id, product, project_id, authority_level,
--   allowed_functions, hide_personal and expires_at -- the scope the caller
--   must enforce -- and never the token or its hash.
--
-- SAME CONTRACT AS 0584, point by point:
--   (a) exact equality only (on token, or on the hash of p_token); a prefix of
--       a live token, or the stored hash itself passed as p_token, matches
--       nothing;
--   (b) the revocation predicate is status = 'active', as in 0584;
--   (c) last_used_at is touched in the same UPDATE ... RETURNING, so the
--       lookup, the checks and the touch are one atomic statement;
--   (d) owned by postgres, search_path pinned, EXECUTE revoked from PUBLIC,
--       anon and authenticated and granted to app_runtime only.
--   New in this function: expires_at IS NULL OR expires_at > now(). Every
--   veridian row has expires_at NULL (0613), so a veridian link resolves
--   exactly as it does through 0584.
--
-- WHO CALLS IT: resolveAiLinkToken() in src/lib/ai-links/user-links.ts, the
--   only caller, used by src/app/api/mcp/[token]/route.ts (GET and POST).
--
-- *** SEQUENCING, READ BEFORE MERGING (same rule as 0584's header) *** The
--   TypeScript in the same pull request calls this function. It does not
--   exist until this file is applied. If that TypeScript is deployed first,
--   EVERY AI-link call fails (undefined function), VERIDIAN links included.
--   Apply this file BEFORE the pull request merges, never after. Rolling back
--   runs the other way round: code first, then the down file.
--
-- ALSO READ BEFORE APPLYING: with this function in place a product='projexa'
--   link resolves on the compliance-tracker route /api/mcp/[token], which
--   runs on Vercel. UNIVERSAL_AI_WORK_LINK_SPEC.md section 10.11 says the M1
--   route never resolves a projexa row, and PMD-26 (A-07) says no link writes
--   through Vercel. No projexa row exists on 2026-09-25 and nothing mints one
--   yet (U-46), so nothing changes live until the first one is minted; the
--   PM settles the conflict before that.
--
-- HOW IT IS APPLIED: through the Supabase MCP (apply_migration) by the PM,
--   after the always-aborted rollback rehearsal (PASS_ROLLED_BACK) and after
--   the PGlite forward/down proof
--   src/lib/ai-links/user-ai-links-resolve-by-hash.pglite.test.ts passes.
--   Idempotent: CREATE OR REPLACE with the same signature and body, and the
--   grants repeat harmlessly.
--
-- DATA LOSS: none. One function is created; nothing else changes.
--
-- ROLLBACK: drizzle/down/0614_build001_link_resolve_by_hash.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- The function's output columns are also PL/pgSQL variables, so every column
-- reference in the statement is qualified with the table alias `l` (0584
-- qualifies its RETURNING list for the same reason).
CREATE OR REPLACE FUNCTION platform.rpc_resolve_ai_link_scoped(p_token text)
RETURNS TABLE(
  id text,
  org_id text,
  user_id text,
  product text,
  project_id text,
  authority_level smallint,
  allowed_functions text[],
  hide_personal boolean,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, compliance, pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE platform.user_ai_links AS l
  SET last_used_at = now()
  WHERE l.status = 'active'
    AND (l.expires_at IS NULL OR l.expires_at > now())
    AND (
      (l.product = 'veridian' AND l.token = p_token)
      OR (l.product = 'projexa'
          AND l.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex'))
    )
  RETURNING l.id, l.org_id, l.user_id, l.product, l.project_id, l.authority_level,
            l.allowed_functions, l.hide_personal, l.expires_at;
END;
$$;

ALTER FUNCTION platform.rpc_resolve_ai_link_scoped(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION platform.rpc_resolve_ai_link_scoped(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.rpc_resolve_ai_link_scoped(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.rpc_resolve_ai_link_scoped(text) TO app_runtime;

COMMIT;
