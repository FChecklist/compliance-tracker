-- R62 B7: Drizzle history sync for fault R48_RLS_DISABLED_ON_SIX_TENANT_TABLES_01
-- (platform.r43_faults, source R48-UAT-S2).
--
-- This migration exists to reconcile this codebase's migration history with
-- RLS that was already enabled directly against the live database in the
-- R56 session (2026-08-27), via Supabase migration
-- r56_enable_rls_six_tenant_tables applied to pcrjmlpuqsbocqfwoxod. That fix
-- was never tracked as a drizzle/*.sql file -- the same class of drift
-- 0327_crr_p2_schema_drizzle_sync.sql's own header documents for the CRR P2
-- tables (CRR-068), just for a different set of tables. This file closes
-- that same gap for the six tables the R48 fault found had RLS switched off
-- (relrowsecurity=false) with zero pg_policies rows:
--   construction_site_instructions, incident_log, memory_store, reuse_cache,
--   ticket_intelligence_items (all five carry an org_id column), and
--   ticket_intelligence_action_items (no org_id of its own -- scoped through
--   its parent ticket_intelligence_items via EXISTS).
--
-- Every statement below is idempotent (ENABLE ROW LEVEL SECURITY is a
-- natural no-op if already enabled; CREATE POLICY is wrapped in a
-- duplicate_object-tolerant DO block) so this is a safe no-op against the
-- live database (which already has these exact objects, re-verified via
-- pg_class.relrowsecurity / pg_policies on 2026-08-28 -- see
-- src/lib/services/r48-six-tenant-tables-rls.test.ts for the CI-checked
-- form of that same assertion), and a correct from-scratch build against
-- any database that does not yet have them (e.g. a fresh CI/preview DB
-- provisioned from this migration history alone).
--
-- NOTE: this migration intentionally does NOT include CREATE TABLE
-- statements. construction_site_instructions, in particular, has no
-- CREATE TABLE migration anywhere in this repo's drizzle/ history (it
-- reached the live database via db:push against schema.ts, not a tracked
-- migration) -- that is a pre-existing drift issue, out of scope for this
-- RLS-focused fix, flagged here rather than silently fixed. The other five
-- tables' CREATE TABLE statements already exist (drizzle/0324_r43_reuse_store.sql
-- for reuse_cache/incident_log/memory_store, drizzle/0169_ticket_intelligence.sql
-- for the two ticket_intelligence_* tables) -- only RLS was missing.
--> statement-breakpoint
ALTER TABLE "compliance"."construction_site_instructions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."incident_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."memory_store" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."reuse_cache" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."ticket_intelligence_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."ticket_intelligence_action_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."construction_site_instructions" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_construction_site_instructions" ON "compliance"."construction_site_instructions" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."incident_log" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_incident_log" ON "compliance"."incident_log" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."memory_store" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_memory_store" ON "compliance"."memory_store" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."reuse_cache" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_reuse_cache" ON "compliance"."reuse_cache" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."ticket_intelligence_items" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_ticket_intelligence_items" ON "compliance"."ticket_intelligence_items" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."ticket_intelligence_action_items" FOR ALL TO app_runtime USING (EXISTS (SELECT 1 FROM compliance.ticket_intelligence_items p WHERE (p.id = ticket_intelligence_action_items.ticket_intelligence_item_id) AND (p.org_id = compliance.current_org_id())));
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_ticket_intelligence_action_items" ON "compliance"."ticket_intelligence_action_items" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
