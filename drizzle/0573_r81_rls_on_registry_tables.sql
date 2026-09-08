-- R81 -- restore the house RLS posture on the two platform registry tables
-- that were created without it.
--
-- WHAT WAS FOUND. Every other audit/registry table in the `platform` schema
-- carries exactly one shape: RLS ENABLED plus a single
-- `service_role_bypass_<table>` policy FOR ALL TO service_role USING (true).
-- r43_faults, sumeet_gap, sumeet_requirements, sumeet_uat, crr_*, uat_*,
-- r39/r42/r43_queue and ~40 more all match it. The effect of that shape is not
-- decoration: `app_runtime` -- the role the running application connects as --
-- holds SELECT/INSERT/UPDATE/DELETE grants on these tables, and RLS with no
-- app_runtime policy is what reduces those grants to zero rows.
-- drizzle/0564's own header records the intent: "600 of 602 tables in
-- compliance/platform have RLS enabled ... app_runtime correctly lacks
-- BYPASSRLS (least privilege, exactly as it should for the app's own role)".
--
-- platform.work_orders and platform.r81_gap were among the handful outside
-- that posture: RLS OFF, zero policies, and the same full DML grant to
-- app_runtime. So any code path running as the application role could read and
-- silently REWRITE the work-order register and the gap ledger -- the two
-- tables whose entire purpose is to be an audit record of what was asked for
-- and what is missing. An audit trail the audited process can edit is not one.
--
-- WHY THIS IS SAFE TO TIGHTEN, established before writing it rather than
-- hoped for afterwards: neither table has a single reader in product code.
-- Both repositories were searched (src/**/*.ts, *.tsx) for `work_orders`,
-- `workOrders` and `r81_gap` -- no hits, and neither table is declared in
-- src/lib/db/schema.ts at all. They are reached only by maintenance scripts,
-- which connect with the service_role credential and are therefore covered by
-- the bypass policy below. Turning RLS on removes access from exactly one
-- role: the one that should never have had it.
--
-- Idempotent by construction. ENABLE ROW LEVEL SECURITY is a no-op when
-- already on, and CREATE POLICY has no IF NOT EXISTS in PostgreSQL -- the
-- DROP ... IF EXISTS first is the standard way to make it re-runnable, not an
-- accident. (An `ADD CONSTRAINT`-style IF NOT EXISTS does not exist either;
-- assuming it does is how a migration passes review and then breaks replay.)
ALTER TABLE platform.work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_bypass_work_orders ON platform.work_orders;
CREATE POLICY service_role_bypass_work_orders ON platform.work_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE platform.r81_gap ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_bypass_r81_gap ON platform.r81_gap;
CREATE POLICY service_role_bypass_r81_gap ON platform.r81_gap
  FOR ALL TO service_role USING (true) WITH CHECK (true);
