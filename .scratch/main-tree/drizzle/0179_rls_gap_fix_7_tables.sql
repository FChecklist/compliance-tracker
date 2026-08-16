-- Fixes a live security gap flagged by Supabase's own advisor (2026-07-13):
-- 7 tables have Row Level Security DISABLED, meaning the anon/authenticated
-- Postgres roles Supabase's PostgREST API uses have completely unrestricted
-- read/write access to them, bypassing the app entirely. None of the 7 have
-- an actual exploit path THROUGH the compliance-tracker app itself (verified
-- below, per table) -- the app's own risk was already zero -- but leaving
-- RLS off means anyone with the anon key can hit these tables directly via
-- Supabase's REST API. This migration closes that gap for all 7, split into
-- two groups by verified access pattern.
--
-- GROUP 1 -- org-scoped tables, real app_runtime traffic (3 tables):
-- email_intelligence_items, email_intelligence_action_items,
-- drafted_communications. Every real read/write in the app goes through
-- withTenantContext() (src/lib/db/tenant-scoped.ts), which runs as the
-- app_runtime Postgres role with org_id set via compliance.current_org_id().
-- Verified by grep: email-intelligence-service.ts and
-- communication-drafting-service.ts both exclusively use withTenantContext,
-- every query already filters by ctx.orgId. Standard org-scoped RLS policy,
-- same shape as scoped_delegations (0164_wave173_scoped_delegations.sql)
-- and email_intelligence_items' own sibling table veri_meeting_action_items
-- (0024_wave32_34_veri_chat_todo_mom.sql) for the join-table case.
--
-- GROUP 2 -- platform-wide tables, zero app_runtime traffic (4 tables):
-- instruction_packages, task_capabilities, capability_improvement_proposals,
-- asset_registration_config. Verified by grep across all of src/: every
-- real call site for these 4 tables (capability-learning-service.ts,
-- capability-audit-service.ts, dialogue-script-executor.ts) uses the raw
-- `db` import from src/lib/db/index.ts, NEVER withTenantContext.
-- src/lib/db/index.ts's `db` connects via DATABASE_URL, which (per
-- tenant-scoped.ts's own header comment) uses the `postgres` role -- the
-- table owner, which Postgres RLS never restricts regardless of what
-- policies exist (unless FORCE ROW LEVEL SECURITY is set, which this repo
-- does not use anywhere). asset_registration_config has ZERO app-code call
-- sites at all (grep confirms; only referenced in schema.ts and offline CI
-- scripts). Because of this, enabling RLS on these 4 tables with NO
-- app_runtime policy at all cannot break any current app behavior -- the
-- app never queries them as app_runtime in the first place -- while fully
-- closing the anon/authenticated PostgREST exposure (RLS defaults to deny
-- for any role with no matching policy). service_role keeps full access for
-- admin tooling/future service-role batch jobs, matching
-- asset_registration_config's own existing "populated only by reviewed
-- migrations" design intent. If a future feature needs app_runtime access
-- to any of these 4, add an explicit policy in its own reviewed migration
-- at that time -- do not retroactively assume today's absence means it's
-- safe to add broad access without re-checking.

-- ─── GROUP 1: org-scoped ──────────────────────────────────────────────────

ALTER TABLE compliance.email_intelligence_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.email_intelligence_items FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_email_intelligence_items ON compliance.email_intelligence_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.email_intelligence_action_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.email_intelligence_action_items FOR ALL TO app_runtime
    USING (email_intelligence_item_id IN (SELECT id FROM compliance.email_intelligence_items WHERE org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_email_intelligence_action_items ON compliance.email_intelligence_action_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.drafted_communications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.drafted_communications FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_drafted_communications ON compliance.drafted_communications FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── GROUP 2: platform-wide, service_role-only (app_runtime never queries
-- these; access happens only via the raw `db` client's `postgres` role,
-- which RLS never restricts) ─────────────────────────────────────────────

ALTER TABLE compliance.instruction_packages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_instruction_packages ON compliance.instruction_packages FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.task_capabilities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_task_capabilities ON compliance.task_capabilities FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.capability_improvement_proposals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_capability_improvement_proposals ON compliance.capability_improvement_proposals FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.asset_registration_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_asset_registration_config ON compliance.asset_registration_config FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
