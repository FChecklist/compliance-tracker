-- R63 (owner directive, 2026-08-29, explicit sign-off given after this
-- session flagged it): Supabase's own advisor flagged 4 platform tables
-- with RLS disabled -- user_ai_links, ddl_capability_probe,
-- pipeline_level_models, ai_connector_providers -- and its generic warning
-- text claims "anyone with the anon key can read or modify every row."
--
-- Verified directly before touching anything (not assumed): that generic
-- claim is NOT currently true for this database. has_table_privilege()
-- for anon/authenticated returns false on all 4 tables for SELECT/INSERT,
-- and pg_default_acl for the platform schema only grants app_runtime/
-- service_role on new tables -- anon/authenticated were never granted
-- access here. So this is a real defense-in-depth gap (correctly worth
-- closing, and cheap to close), not an active "tokens are readable right
-- now" incident as first suspected before this check -- worth recording
-- precisely rather than letting the scarier, unverified claim stand.
--
-- app_runtime (the role this app's own Drizzle connection authenticates
-- as -- DATABASE_URL) does NOT have BYPASSRLS (confirmed:
-- pg_roles.rolbypassrls = false for app_runtime, true for postgres/
-- service_role). That means simply flipping ENABLE ROW LEVEL SECURITY
-- with no policy would break the app's own real access to these 4 tables
-- -- exactly the risk Supabase's own advisory result warned about
-- ("enabling RLS without policies will block all access") and exactly why
-- this session did not auto-apply the bare remediation_sql it was
-- initially handed. Each table below gets RLS enabled AND an explicit
-- allow-all policy scoped to app_runtime (this app's only real caller,
-- already gated by requireAuth()/requireAuthOrApiKey() at the API layer
-- for every route that touches these tables) so the app keeps working
-- unchanged, while anon/authenticated (and any future accidental GRANT to
-- them) are denied by RLS's own default-deny -- a second, independent
-- barrier beyond "they simply have no GRANT today."
--
-- 0330_r63_user_ai_links.sql's own header comment argued "No RLS: token
-- resolution happens before any tenant context exists." That reasoning
-- conflated two different access paths: resolveAiLinkToken() (src/lib/
-- ai-links/user-links.ts) reads via Drizzle/app_runtime, a completely
-- separate connection from Supabase's anon-key PostgREST surface that RLS
-- actually governs -- a policy scoped to the app_runtime ROLE (not
-- auth.uid()/a per-tenant condition) does not require or depend on a
-- Supabase Auth session existing, so it does not affect token resolution
-- at all. Correcting that reasoning here rather than leaving the original
-- comment's now-superseded rationale as the last word.

ALTER TABLE "platform"."user_ai_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "app_runtime_full_access" ON "platform"."user_ai_links"
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "platform"."ai_connector_providers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "app_runtime_full_access" ON "platform"."ai_connector_providers"
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "platform"."pipeline_level_models" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "app_runtime_full_access" ON "platform"."pipeline_level_models"
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ddl_capability_probe is not part of this app's Drizzle schema at all
-- (a one-off manual diagnostic table from R60's own DDL-capability check,
-- platform.error_log E-68) -- locked down the same way regardless, since
-- app_runtime still holds live GRANTs on it and it should not be treated
-- any less carefully than the 3 real app tables above.
ALTER TABLE "platform"."ddl_capability_probe" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "app_runtime_full_access" ON "platform"."ddl_capability_probe"
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
