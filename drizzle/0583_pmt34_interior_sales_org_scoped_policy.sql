-- PM-T34 part 1 (2026-09-10). DOD-T4 (PM's own live tenant-isolation
-- instrument) found compliance.interior_sales_packages and
-- compliance.interior_sales_package_items carried only
-- app_runtime_full_access (FOR ALL TO app_runtime USING (true)) -- no
-- org_id restriction at all, a live cross-tenant read/write hole,
-- structurally the same class as F-005/0577/0578 on the platform schema
-- tables closed earlier today.
--
-- Verified before writing this file, not assumed:
--   - both tables carry their own `org_id text NOT NULL` column directly
--     (information_schema.columns), so a direct per-table predicate is
--     correct -- neither table scopes tenancy through a parent-table join.
--   - every reader/writer of either table (all 12 exported functions in
--     src/lib/services/interior-sales-package-service.ts, the ONLY file
--     in either repo that references them) already runs inside
--     withTenantContext(), so this policy swap needs no TypeScript
--     change alongside it.
--   - both tables hold 0 rows live -- a pure policy swap, no data
--     migration.
--
-- Dry-run validated live (BEGIN...ROLLBACK against pcrjmlpuqsbocqfwoxod,
-- nothing committed): inserted probe rows under two distinct org_ids,
-- applied this exact policy, set_config'd app.current_org_id to each
-- org's context in turn. Org A's context saw exactly its own row (not
-- org B's); org B's context saw exactly its own row (not org A's) --
-- confirmed by direct row-level SELECT, not a bare count, both
-- directions.
ALTER TABLE compliance.interior_sales_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_sales_package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_runtime_full_access" ON compliance.interior_sales_packages;
CREATE POLICY "app_runtime_org_scoped" ON compliance.interior_sales_packages
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());

DROP POLICY IF EXISTS "app_runtime_full_access" ON compliance.interior_sales_package_items;
CREATE POLICY "app_runtime_org_scoped" ON compliance.interior_sales_package_items
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());
