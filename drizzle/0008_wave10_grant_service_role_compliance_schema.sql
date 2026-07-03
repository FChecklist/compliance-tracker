-- Wave 10 (discovered during live MCP verification, not part of the
-- original wave plan -- a genuine pre-existing bug, not something Wave 10
-- introduced): service_role had ZERO privileges on the compliance schema.
--
-- /api/mcp (Edge runtime) authenticates to Supabase using
-- SUPABASE_SERVICE_ROLE_KEY via createClient(url, key, { db: { schema:
-- 'compliance' } }) -- a plain Supabase-JS/PostgREST client, not Drizzle.
-- PostgREST executes as the literal Postgres role `service_role`.
-- rolbypassrls=true only bypasses ROW LEVEL SECURITY -- it does not grant
-- table-level SELECT/INSERT/UPDATE/DELETE, which is a completely separate
-- Postgres privilege system. Confirmed directly:
--   SET ROLE service_role; SELECT * FROM compliance.api_keys LIMIT 1;
--   => ERROR 42501: permission denied for schema compliance
--
-- This means /api/mcp's admin client has never been able to read or write
-- ANY compliance.* table (compliance_items, departments, api_keys, etc.)
-- since the route was first built -- all 7 MCP tools have always failed
-- with an opaque "Unauthorized" response, unrelated to bearer-token
-- validity. Existing default privileges only ever granted app_runtime
-- (the Drizzle/Node-runtime role), never service_role.

GRANT USAGE ON SCHEMA compliance TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA compliance TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA compliance TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA compliance
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA compliance
  GRANT USAGE ON SEQUENCES TO service_role;
