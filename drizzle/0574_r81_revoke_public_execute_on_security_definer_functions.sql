-- R81 SEC-04 -- stop anonymous callers executing SECURITY DEFINER functions.
--
-- WHAT WAS WRONG. Four functions in the `compliance` schema are SECURITY
-- DEFINER (they run with the definer's rights, not the caller's) and all four
-- were executable by PUBLIC -- three because their proacl was NULL, which in
-- PostgreSQL means the default grant of EXECUTE to PUBLIC, and
-- gap_log_orgs_with_recent_activity because its ACL literally begins `=X/postgres`,
-- where the empty left-hand side IS PUBLIC.
--
-- That matters here and not in an ordinary database because the `compliance`
-- schema is exposed over PostgREST. An unauthenticated caller holding only the
-- publishable anon key can therefore reach them at /rest/v1/rpc/<name> by
-- sending the `Content-Profile: compliance` header. This was proved live, not
-- inferred: that request returned HTTP 200. Without the profile header the same
-- call 404s with PGRST202 because PostgREST only searches `public`, which is
-- exactly why a naive probe would have concluded these were unreachable.
--
-- The two that matter most:
--   * gap_log_orgs_with_recent_activity() returns a DISTINCT list of org_ids
--     active in the last 24 hours -- a cross-tenant customer list handed to
--     anyone with the public key.
--   * backfill_registered_assets(text) loops over every active row of
--     asset_registration_config and upserts into platform_assets for EVERY
--     tenant. It is not SQL-injectable (the caller's text is only an equality
--     filter) but it is an unauthenticated, unbounded, cross-tenant WRITE, run
--     against a pool whose max is 5 (src/lib/db/tenant-scoped.ts).
--
-- WHY THIS IS A REVOKE FROM **PUBLIC**, AND NOT FROM anon/authenticated.
-- Revoking from anon and authenticated by name looks equivalent and is not:
-- the grant being exercised is the implicit PUBLIC one, so revoking the named
-- roles would leave PUBLIC intact and change nothing at all. The check would
-- then report success while the endpoint stayed open -- the exact false-green
-- shape this programme keeps finding. Revoke PUBLIC, then grant back
-- explicitly to the roles that genuinely need it.
--
-- WHY THE GRANTS BACK ARE NOT OPTIONAL. compliance.conversation_org_id(text)
-- is called inside a live RLS policy --
-- `app_runtime_insert_own_org_conversation` on compliance.conversation_participants,
-- `USING (compliance.conversation_org_id(conversation_id) = compliance.current_org_id())`.
-- That policy is declared FOR {app_runtime}, so app_runtime must keep EXECUTE
-- or every insert into that table starts failing. A blanket revoke without
-- these grants would have converted a security finding into an outage, which
-- is why the policy dependency was checked before the statement was written
-- rather than after it shipped.
--
-- auto_register_asset() returns `trigger`; PostgREST does not expose
-- trigger-returning functions over /rpc, so it was never actually reachable
-- that way. It is included anyway: it costs nothing, and "not reachable by the
-- route we happened to test" is not the same as "not reachable".
REVOKE EXECUTE ON FUNCTION compliance.auto_register_asset() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION compliance.backfill_registered_assets(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION compliance.conversation_org_id(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION compliance.gap_log_orgs_with_recent_activity() FROM PUBLIC;

-- Restore exactly the access the application and maintenance paths need.
GRANT EXECUTE ON FUNCTION compliance.conversation_org_id(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION compliance.gap_log_orgs_with_recent_activity() TO app_runtime;
GRANT EXECUTE ON FUNCTION compliance.auto_register_asset() TO service_role;
GRANT EXECUTE ON FUNCTION compliance.backfill_registered_assets(text) TO service_role;
GRANT EXECUTE ON FUNCTION compliance.conversation_org_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION compliance.gap_log_orgs_with_recent_activity() TO service_role;
