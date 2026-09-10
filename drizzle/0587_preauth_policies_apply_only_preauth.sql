-- P0 cross-tenant read: four tables expose every tenant's rows to the app role.
--
-- FOUND BY the first full cross-tenant sweep run on this database: every
-- org-scoped RLS table in compliance and platform holding rows for two or more
-- orgs, probed under up to three org contexts each, as app_runtime with an
-- explicit SET LOCAL ROLE (D73), inside BEGIN/ROLLBACK. 93 tables, 279 probes.
--
--   compliance.api_key_request_log   53611 other tenants' rows visible
--   compliance.users                  1092 other tenants' rows visible
--   compliance.api_keys                 33 other tenants' rows visible
--   compliance.report_share_links        6 other tenants' rows visible
--
-- THE MECHANISM IS ONE MECHANISM. Postgres combines PERMISSIVE policies with
-- OR, not AND. All four tables already carry a correct app_runtime_tenant_
-- isolation policy (org_id = compliance.current_org_id()). Sitting beside it is
-- a pre-auth policy with USING (true) or WITH CHECK (true). The unconditional
-- one wins on every row, for every query, forever.
--
-- THE PRE-AUTH POLICIES ARE NOT A MISTAKE, THEIR SCOPE IS. Resolving a user by
-- email, or validating an API key, genuinely has to happen before any org
-- context exists. Dropping these policies would break login. What is wrong is
-- that a pre-authentication exception was written as a PERMANENT grant, so it
-- also applies to every authenticated request that follows.
--
-- THE FIX. compliance.current_org_id() is
--   SELECT NULLIF(current_setting('app.current_org_id', true), '')
-- so it returns NULL exactly when no tenant context has been established --
-- which is the precise definition of "pre-auth". Each pre-auth policy is
-- therefore narrowed from `true` to `compliance.current_org_id() IS NULL`.
-- Before a session exists the exception applies exactly as before. The moment
-- the app sets a tenant context, the exception stops applying and only the
-- tenant-isolation policy remains.
--
-- No application code changes. No new function. No call-site migration.
--
-- BOTH LEGS WERE PROVEN IN A ROLLED-BACK TRANSACTION BEFORE THIS FILE EXISTED:
--   authenticated (app.current_org_id = projexa_demo_org):
--     users foreign 1083 -> 0 (own 10 kept), api_keys foreign 30 -> 0 (own 4 kept),
--     request_log foreign 51612 -> 0, share_links foreign 6 -> 0
--   pre-auth (app.current_org_id = ''):
--     users 1093 readable, api_keys 34, request_log 53614, share_links 7 -- unchanged
--
-- NOT IN SCOPE, and deliberately so: compliance.platform_assets and
-- compliance.embeddings appeared in the first sweep and are NOT leaks. Their
-- policies carry `OR org_id IS NULL` and `OR is_platform_scope = true`
-- respectively, and the rows they expose have no owning tenant. The first
-- sweep counted a NULL org_id as foreign, which was a defect in the probe, not
-- in the policy. Re-measured with "foreign" meaning a different IDENTIFIABLE
-- tenant, both return zero.

ALTER POLICY app_runtime_preauth_read_users
  ON compliance.users USING (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_update_users
  ON compliance.users USING (compliance.current_org_id() IS NULL)
                 WITH CHECK (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_insert_users
  ON compliance.users WITH CHECK (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_read_api_keys
  ON compliance.api_keys USING (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_update_api_keys_last_used
  ON compliance.api_keys USING (compliance.current_org_id() IS NULL)
                    WITH CHECK (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_read_api_key_request_log
  ON compliance.api_key_request_log USING (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_insert_api_key_request_log
  ON compliance.api_key_request_log WITH CHECK (compliance.current_org_id() IS NULL);

ALTER POLICY app_runtime_preauth_read_report_share_links
  ON compliance.report_share_links USING (compliance.current_org_id() IS NULL);

-- D58: this migration can fail. If any of the eight policies is missing or has
-- been renamed, ALTER POLICY raises and the whole transaction rolls back rather
-- than leaving some tables narrowed and others wide open.
