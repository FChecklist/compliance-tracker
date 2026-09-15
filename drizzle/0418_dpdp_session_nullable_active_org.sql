-- WO-DPDP-001 Phase 2: a brand-new identity with zero organisations still
-- needs a session to reach "create an organisation" -- there's no other
-- authenticated surface for that bootstrap step. See dpdp-auth-service.ts's
-- verifyDpdpMagicLink and schema.ts's own comment on dpdp.session.
ALTER TABLE "dpdp"."session" ALTER COLUMN "active_org_id" DROP NOT NULL;
