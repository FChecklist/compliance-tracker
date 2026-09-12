-- P2.6 (W-ENV, R81-ADDENDUM-B phase S5): registry tables are app-writable
-- and should not be.
--
-- WHAT WAS FOUND, verified live against pcrjmlpuqsbocqfwoxod (2026-09-10).
-- platform.task_capabilities carries exactly one non-service-role policy:
--
--   app_runtime_org_scoped_or_platform_default
--   FOR ALL TO public
--   USING/WITH CHECK: (org_id = compliance.current_org_id()) OR (org_id IS NULL)
--
-- Two problems, not one. First, the role is `public`, not `app_runtime` --
-- every other table in this schema scopes its non-bypass policy to
-- app_runtime specifically (see 0573/0575's own header). Second, and worse:
-- the table's own comment says it is "platform-wide by design (orgId
-- nullable) ... tracking rolling X/Y/A/B classification history ... for the
-- Auditor->Higher-AI learning loop" -- the org_id IS NULL rows ARE the
-- registry, one row per distinct capability, meant to be curated by the
-- audit process, not per-tenant application data. The current policy lets
-- ANY caller -- any tenant's app_runtime request context, or literally any
-- other role picking up the public grant -- write those platform-wide rows.
-- Concretely: one tenant's user, through an ordinary authenticated request,
-- can poison the capability memory every other tenant's AI reasoning reads
-- from.
--
-- THE FIX. Split the single policy in two: app_runtime keeps full access to
-- its own org's rows (org_id = current_org_id(), unchanged in effect), and
-- loses WRITE on org_id IS NULL rows -- those become service_role-only,
-- matching every other true registry table's shape. Read access to org_id
-- IS NULL rows is deliberately LEFT OPEN to app_runtime (a SELECT-only
-- policy) since a legitimate runtime consumer reading platform defaults at
-- request time is plausible and this migration's job is to close the WRITE
-- hole specifically, not to guess at every read path.
--
-- PROVEN, NOT JUST WRITTEN. Ran this exact DDL inside BEGIN...ROLLBACK
-- against the live database (2026-09-10), then attempted a write of an
-- org_id-NULL row as each role before rolling everything back:
--   SET LOCAL ROLE app_runtime; INSERT ... (org_id NULL)
--     -> REFUSED: "new row violates row-level security policy for table
--        \"task_capabilities\""
--   SET LOCAL ROLE service_role; INSERT ... (org_id NULL)
--     -> SUCCEEDED
--   ROLLBACK; SELECT count(*) ... -> 0 (nothing persisted)
-- See src/lib/services/task-capabilities-registry-lockdown.test.ts, which
-- asserts on this file's exact SQL clauses (the same mechanism this repo
-- already uses for RLS regression tests -- e.g.
-- r48-six-tenant-tables-rls.test.ts -- because there is no live Postgres
-- connection available from the test runner in CI/this sandbox).
--
-- BLAST RADIUS -- why this migration is NOT applied here. Traced every
-- write to task_capabilities in both repos (grep, then read):
--   src/lib/services/capability-audit-service.ts writes org_id-NULL rows
--   (task_capabilities has no single owning org -- PLATFORM_AUDIT_QUERY_ORG_ID
--   is a sentinel, not a real org) through the app_runtime-connected `db`
--   (src/lib/db/index.ts, i.e. DATABASE_URL), via:
--     .update(taskCapabilities)...           (closeImprovementLoop, ~line 491)
--     .update(taskCapabilities)... (x4 more, the accept/reject/link flows)
--   called from two routes:
--     /api/internal/capability-audit/run/route.ts   -- CRON_SECRET-gated,
--       not end-user-reachable.
--     /api/ai/team/capability-improvements/route.ts -- requireAuth()-gated,
--       IS end-user-reachable.
--   Applying this policy alone, before those write paths move to a
--   service-role client, turns a silent cross-tenant integrity hole into a
--   broken end-user route -- a worse failure, not a better one. This ships
--   as a two-part change-set: the service switches its platform-scope
--   writes to a service-role client FIRST (see
--   src/lib/services/capability-audit-service.ts and the two routes above,
--   changed alongside this migration under a narrow, explicitly-granted
--   surface exception -- normally out of W-ENV's scope), and only then does
--   this policy apply. The owner/PM applies this file after reading that
--   ordering; it must not land before the service-side change does.
--
-- SEPARATE, PRE-EXISTING DEFECT, not fixed here (out of P2.6's scope; noted
-- for its own ticket). platform.capability_improvement_proposals already
-- has ONLY a service_role_bypass policy -- no app_runtime policy of any
-- kind. capability-audit-service.ts's .insert()/.update() calls against it
-- via the app_runtime connection are therefore ALREADY failing today, and
-- silently swallowed by that service's own try/catch. The improvement
-- proposals this loop is supposed to record have been quietly going
-- nowhere. The real fix there is two things, not one: the missing policy,
-- and the catch block that hides a permission error well enough that this
-- stayed invisible.
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY, matching
-- 0573/0575's established technique (PostgreSQL has no native IF NOT EXISTS
-- for CREATE POLICY).
ALTER TABLE platform.task_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_runtime_org_scoped_or_platform_default" ON platform.task_capabilities;

DROP POLICY IF EXISTS "app_runtime_org_scoped" ON platform.task_capabilities;
CREATE POLICY "app_runtime_org_scoped" ON platform.task_capabilities
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());

DROP POLICY IF EXISTS "app_runtime_read_platform_defaults" ON platform.task_capabilities;
CREATE POLICY "app_runtime_read_platform_defaults" ON platform.task_capabilities
  FOR SELECT TO app_runtime
  USING (org_id IS NULL);

DROP POLICY IF EXISTS "service_role_bypass_task_capabilities" ON platform.task_capabilities;
CREATE POLICY "service_role_bypass_task_capabilities" ON platform.task_capabilities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
