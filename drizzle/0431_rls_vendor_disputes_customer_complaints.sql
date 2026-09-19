-- Applied out-of-band via the Supabase MCP (matching this repo's established
-- practice, see drizzle/0245's own header) on 2026-09-19, immediately after
-- 0430_sharp_micromax.sql. Hand-written, not `bun run db:generate` output,
-- because RLS policies are DDL drizzle-kit does not emit.
--
-- Closes a real gap found while re-verifying 0430's own two new tables
-- (construction_vendor_disputes, construction_customer_complaints): every
-- sibling construction_* table (construction_boqs, construction_change_orders,
-- construction_punch_list_items, ...) has RLS enabled with a two-policy
-- pattern -- app_runtime_tenant_isolation (org_id = compliance.current_org_id())
-- and a service_role bypass -- but 0430's two new tables were created with
-- RLS left off entirely, an oversight from that migration, not a deliberate
-- design choice. Fixed here rather than silently left, matching the exact
-- policy shape/naming already used by every other table in this family.

ALTER TABLE "compliance"."construction_vendor_disputes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."construction_vendor_disputes" AS PERMISSIVE FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
CREATE POLICY "service_role_bypass_construction_vendor_disputes" ON "compliance"."construction_vendor_disputes" AS PERMISSIVE FOR ALL TO service_role USING (true);

ALTER TABLE "compliance"."construction_customer_complaints" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."construction_customer_complaints" AS PERMISSIVE FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
CREATE POLICY "service_role_bypass_construction_customer_complaints" ON "compliance"."construction_customer_complaints" AS PERMISSIVE FOR ALL TO service_role USING (true);
