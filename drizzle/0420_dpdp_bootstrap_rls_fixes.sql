-- WO-DPDP-001 Phase 2: two more real bugs found by the same live smoke test
-- as 0419, both the same underlying class (a write happens before/across
-- the tenant context that would normally scope it):
--
-- 1. dpdp_organisation_auto_fiduciary's trigger function ran SECURITY
--    INVOKER (the default) -- as app_runtime, subject to app_runtime's own
--    RLS on dpdp.org_capability. It fires for EVERY organisation insert,
--    including (a) org-creation bootstrap, where there is no tenant
--    context yet at all, and (b) nameDpdpRelationship's counterpart-org
--    creation, where the open transaction's context is the ACTOR's org,
--    not the new counterpart's -- neither satisfies
--    `org_id = dpdp.current_org_id()`. SECURITY DEFINER makes the trigger
--    run as its owner (this migration's applying role, effectively
--    superuser-equivalent on this project), bypassing RLS entirely --
--    correct for a trigger whose whole job is cross-cutting bookkeeping
--    the calling session's own tenant scope was never meant to gate.
--
-- 2. dpdp.event had no INSERT path at all for the bootstrap case (creating
--    an organisation logs an "organisation_created" event before any
--    session has a tenant context to log it under). Added as an ADDITIONAL
--    permissive policy (Postgres ORs multiple permissive policies for the
--    same command) rather than editing the existing org-scoped one, so a
--    session that DOES have a context still cannot write another org's
--    event log -- only the true no-context bootstrap path is opened.
--
-- The THIRD instance of this same bug class (inviteDpdpMemberWithDb logging
-- an event for the counterpart org while the caller's context is the
-- actor's org, from nameDpdpRelationship) was fixed in application code
-- instead (src/lib/services/dpdp-organisation-service.ts) -- that event
-- log call was moved to the correctly-scoped inviteDpdpMember wrapper.
ALTER FUNCTION dpdp.auto_fiduciary_capability() SECURITY DEFINER;

CREATE POLICY app_runtime_event_preauth_insert ON dpdp.event FOR INSERT TO app_runtime
  WITH CHECK (dpdp.current_org_id() IS NULL);
