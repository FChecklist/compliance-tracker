-- Gap closure, AUDIT_2026-07-09.md (Security Assessment / Database Review).
-- Applied live via Supabase MCP apply_migration on 2026-07-09; this file is
-- the committed record. Verified afterward: 357 of 357 compliance-schema
-- tables now have relforcerowsecurity=true (was 0 of 357).
--
-- FORCE ROW LEVEL SECURITY was enabled on 0 of 357 compliance-schema tables
-- (confirmed live via pg_class.relforcerowsecurity). Non-exploitable today
-- (app_runtime, the real application role, is confirmed NOSUPERUSER
-- NOBYPASSRLS and is not the table owner -- postgres owns everything, so
-- ENABLE alone already fully applies RLS for app_runtime) but fragile: any
-- future ALTER TABLE ... OWNER TO app_runtime (an easy mistake when
-- consolidating roles or copy-pasting a migration template) would silently
-- disable RLS enforcement for that role on every affected table with no
-- error. FORCE is a defense-in-depth no-op today and only ever matters if
-- that mistake happens -- zero behavior change for any current connection.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'compliance'
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
