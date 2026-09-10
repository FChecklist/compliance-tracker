-- P2.6 follow-up (C-14, external review 2026-09-10 / finding F-2026-0910-006).
--
-- WHAT WAS FOUND. platform.capability_improvement_proposals has ONLY
-- service_role_bypass -- no app_runtime policy of any kind, not even SELECT.
-- This table has NO org_id column at all (checked schema.ts): every row is
-- unconditionally platform-wide by construction, not by convention. Before
-- this phase's companion code change (capability-audit-service.ts), every
-- read AND write against this table via the app_runtime-connected `db` was
-- ALREADY failing -- silently, because the calling route's per-item catch
-- only pushed to an array nobody alerted on (see that route's own fix in
-- this same commit). The improvement proposals this loop is supposed to
-- record had been quietly going nowhere since the RLS policy was written.
--
-- THE FIX. Give app_runtime a SELECT-only policy (unconditional true --
-- there is no org to scope by) so the read side
-- (listImprovementProposals(), the veridian_admin-only review UI at
-- /api/ai/team/capability-improvements) can work over the normal app_runtime
-- connection again. Writes stay service_role-only on purpose -- this table
-- is Auditor-AI-written governance data, not application data, the same
-- posture as platform.task_capabilities under drizzle/0577. The companion
-- code change (same commit) already routes every write through the
-- service-role client rather than wait for this migration, so applying it
-- changes nothing about what already works -- it only restores the read
-- path.
--
-- NOT APPLIED -- same standing instruction as 0577: PM/owner applies after
-- review. Unlike 0577, this one is not blocked on anything else: there is
-- no write path anywhere left depending on app_runtime access to this
-- table (verified: same grep sweep as C-13, capability-audit-service.ts is
-- the only file that references capabilityImprovementProposals, and every
-- one of its call sites is already service-role after this commit).
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY, matching
-- 0573/0575/0577's established technique.
ALTER TABLE platform.capability_improvement_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_runtime_read_capability_improvement_proposals" ON platform.capability_improvement_proposals;
CREATE POLICY "app_runtime_read_capability_improvement_proposals" ON platform.capability_improvement_proposals
  FOR SELECT TO app_runtime
  USING (true);

DROP POLICY IF EXISTS "service_role_bypass_capability_improvement_proposals" ON platform.capability_improvement_proposals;
CREATE POLICY "service_role_bypass_capability_improvement_proposals" ON platform.capability_improvement_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
