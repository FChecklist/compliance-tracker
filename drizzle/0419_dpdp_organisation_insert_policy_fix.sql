-- WO-DPDP-001 Phase 2: real bug found by a live smoke test
-- (scripts/tmp-dpdp-smoke-test.ts, not committed) -- drizzle/0415's single
-- FOR ALL policy on dpdp.organisation used its USING clause for INSERT too
-- (Postgres RLS default when WITH CHECK is omitted), so creating a BRAND
-- NEW org could never satisfy it: `id = dpdp.current_org_id()` is false (no
-- GUC set yet for a row that doesn't exist), and no relationship exists
-- yet either. Hit on both real INSERT paths: createDpdpOrganisation (no
-- context at all -- signup) and nameDpdpRelationship's counterpart-org
-- creation (context set to a DIFFERENT org than the one being inserted).
--
-- Fix: split into SELECT/UPDATE (relationship-scoped, unchanged logic) and
-- a separate INSERT policy that is always permitted -- a brand-new org row
-- belongs to nobody yet, so there is nothing for tenant isolation to
-- protect on that side; ownership is established by the membership row
-- inserted in the same transaction right after.
DROP POLICY IF EXISTS app_runtime_visible_orgs ON dpdp.organisation;

CREATE POLICY app_runtime_read_visible_orgs ON dpdp.organisation FOR SELECT TO app_runtime
  USING (
    id = dpdp.current_org_id()
    OR EXISTS (SELECT 1 FROM dpdp.relationship r WHERE r.from_org = dpdp.current_org_id() AND r.to_org = organisation.id AND r.ended_at IS NULL)
    OR EXISTS (SELECT 1 FROM dpdp.relationship r WHERE r.to_org = dpdp.current_org_id() AND r.from_org = organisation.id AND r.ended_at IS NULL)
  );

CREATE POLICY app_runtime_update_own_org ON dpdp.organisation FOR UPDATE TO app_runtime
  USING (id = dpdp.current_org_id());

CREATE POLICY app_runtime_insert_any_org ON dpdp.organisation FOR INSERT TO app_runtime
  WITH CHECK (true);
