-- P0 RLS fix: narrow 8 pre-auth RLS policies on compliance.users /
-- compliance.api_keys / compliance.api_key_request_log /
-- compliance.report_share_links from an unconditional USING(true)/WITH
-- CHECK(true) to USING(compliance.current_org_id() IS NULL) /
-- WITH CHECK(compliance.current_org_id() IS NULL).
--
-- Applied live via the Supabase MCP apply_migration tool on 2026-09-11
-- against pcrjmlpuqsbocqfwoxod (see supabase_migrations.schema_migrations
-- version 20260911094933, name r83_p0_preauth_policies_scope_to_no_tenant_context)
-- -- this file is the repo-side record of that out-of-band apply, matching
-- this project's established practice for hand-authored SQL applied directly
-- (see drizzle/0245's own header). Do NOT re-run this file's DDL against
-- pcrjmlpuqsbocqfwoxod; it is already live there. It exists so a from-empty
-- rebuild (or any other environment) has the statement on record, and so
-- db:generate's next diff doesn't propose reverting it.
--
-- WHY: Postgres RLS permissive policies for the same command are OR'd
-- together. Each of these 4 tables also carries an app_runtime_tenant_isolation
-- policy (org_id = current_org_id()) that correctly scopes an authenticated,
-- tenant-context request to its own org -- but because the preauth policy's
-- qual was unconditionally true, it ALSO matched every authenticated request,
-- silently defeating tenant_isolation for these commands: any app_runtime
-- query, even one running inside a real org's withTenantContext transaction,
-- could read/write every other org's rows on these 4 tables.
--
-- THE FIX DOES NOT CHANGE PREAUTH BEHAVIOUR. Genuine preauth call sites (the
-- plain, non-tenant-scoped `db` client -- requireAuth()'s email lookup,
-- validateApiKey()'s key-hash lookup, and the other call sites documented in
-- src/lib/db/preauth-lookups.ts's own header) never set app.current_org_id,
-- so compliance.current_org_id() is already NULL for them --
-- USING(current_org_id() IS NULL) matches exactly the same rows USING(true)
-- did. It only removes the match for requests that DO have a real org
-- context set, which is exactly the leak.
--
-- REAPPLICATION of migration 0587 (applied 2026-09-10, reverted same day
-- pending a call-site audit). That audit is complete: all previously-risky
-- call sites confirmed repointed to narrow SECURITY DEFINER functions
-- (compliance.lookup_user_by_email / lookup_api_key_by_hash /
-- record_api_key_request_batch, all owned by `postgres`, which has
-- rolbypassrls=true -- confirmed live before this migration) or to
-- lookupUserByEmail(); the two originally-flagged raw call sites
-- (support-session-service.ts:96, dispatch-completion-monitor/run/route.ts:66)
-- independently re-confirmed by direct source inspection the same session
-- this was applied: both use the plain `db` client with no withTenantContext
-- wrapper, so current_org_id() is NULL for them by construction, unaffected
-- by this narrowing.
--
-- PROVEN both directions via BEGIN...ROLLBACK against the live DB
-- immediately before applying, then re-proven live (real, committed reads,
-- not rolled back) immediately after:
--   no context: users=1093, api_keys=35, api_key_request_log(projexa_demo_org)=2002,
--     report_share_links(projexa_demo_org)=1 -- all unrestricted, matching pre-fix.
--   real org context (obux019rsc5nzxjx93rrpc1j): users=100 (0 foreign rows),
--     api_keys 0 foreign.
--   real org context (projexa_demo_org): api_key_request_log 0 foreign,
--     report_share_links 0 foreign.

ALTER POLICY app_runtime_preauth_insert_api_key_request_log ON compliance.api_key_request_log
  WITH CHECK (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_read_api_key_request_log ON compliance.api_key_request_log
  USING (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_read_api_keys ON compliance.api_keys
  USING (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_update_api_keys_last_used ON compliance.api_keys
  USING (compliance.current_org_id() IS NULL)
  WITH CHECK (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_read_report_share_links ON compliance.report_share_links
  USING (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_insert_users ON compliance.users
  WITH CHECK (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_read_users ON compliance.users
  USING (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_update_users ON compliance.users
  USING (compliance.current_org_id() IS NULL)
  WITH CHECK (compliance.current_org_id() IS NULL);
