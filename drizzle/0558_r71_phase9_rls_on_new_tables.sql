-- R71 Phase 9: RLS on the two new tables migration 0557 created
-- (compliance.engagements, compliance.tenant_memory_profile). Both hold
-- tenant-sensitive data (client_ref/matter_name are exactly the barrier
-- R-IMG-22 exists to enforce) and RLS-forced is this schema's own standing
-- convention for every tenant-scoped table -- leaving these two unprotected
-- would be a real, immediate gap, not a hypothetical one.
ALTER TABLE compliance.engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.engagements FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_org_scoped ON compliance.engagements
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());
CREATE POLICY service_role_bypass_engagements ON compliance.engagements
  FOR ALL TO service_role USING (true);

ALTER TABLE compliance.tenant_memory_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.tenant_memory_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_org_scoped ON compliance.tenant_memory_profile
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());
CREATE POLICY service_role_bypass_tenant_memory_profile ON compliance.tenant_memory_profile
  FOR ALL TO service_role USING (true);
