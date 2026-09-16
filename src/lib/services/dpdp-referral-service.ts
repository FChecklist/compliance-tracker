// WO-DPDP-002 Section 4.1 (Referral test row: "Shared-advisor and
// self-referral both block, with reasons.")
//
// dpdp.referral / dpdp.referral_event existed only as schema (0415) --
// 'shared_advisor'/'self_referral' were named in a schema.ts comment, never
// implemented anywhere (confirmed by a repo-wide grep before writing this).
// This is the missing service: given a referral code and the org being
// referred, decide whether the referral is a genuine new introduction or a
// conflict that should earn no credit.
//
//   self_referral   -- the person who owns the code already belongs to the
//                      org they're "referring" (referring yourself).
//   shared_advisor  -- an org the referrer already belongs to already has an
//                      active 'advises' relationship TO the referred org --
//                      i.e. the referrer's own firm is already that org's
//                      advisor, so this isn't a new introduction, it's an
//                      existing client being run back through the referral
//                      scheme for credit.
//
// Neither check requires the referred org's own tenant context (referral/
// referral_event carry no RLS -- 0415 lists both as cross-org-by-design), so
// this runs on the plain `db` client, no withDpdpContext needed.
import { and, eq, isNull } from "drizzle-orm"
import { db, dpdpMembership, dpdpReferral, dpdpReferralEvent, dpdpRelationship } from "@/lib/db"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ReferralBlockReason = "self_referral" | "shared_advisor"

/** Pure decision: does referring `referredOrgId` via `referrerIdentityId` conflict? Exported separately from the DB-touching wrapper so the rule itself is unit-testable without a database. */
export function decideReferralConflict(input: {
  referrerActiveOrgIds: string[]
  referredOrgId: string
  // Not assumed pre-filtered -- checked against referrerActiveOrgIds here
  // too, so a caller that passes every 'advises' relationship it happens to
  // have handy (rather than pre-filtering) still gets the correct answer.
  advisoryRelationshipsFromReferrerOrgs: Array<{ fromOrg: string; toOrg: string }>
}): ReferralBlockReason | null {
  if (input.referrerActiveOrgIds.includes(input.referredOrgId)) return "self_referral"
  const alreadyAdvises = input.advisoryRelationshipsFromReferrerOrgs.some(
    (r) => r.toOrg === input.referredOrgId && input.referrerActiveOrgIds.includes(r.fromOrg),
  )
  if (alreadyAdvises) return "shared_advisor"
  return null
}

/**
 * Looks up whose code this is, evaluates the conflict rule against real
 * membership/relationship data, and records the outcome as a
 * dpdp.referral_event row (credit-worthy or blocked, with a reason).
 */
export async function recordReferralAttempt(code: string, referredOrgId: string): Promise<{ referralIdentityId: string; blocked: boolean; reason: ReferralBlockReason | null }> {
  const referral = await db.query.dpdpReferral.findFirst({ where: eq(dpdpReferral.code, code) })
  if (!referral) throw new ServiceError("That referral code is not recognised", 404)
  if (referral.state !== "active") throw new ServiceError("That referral code is no longer active", 400)

  const referrerActiveOrgIds = (
    await db.query.dpdpMembership.findMany({ where: and(eq(dpdpMembership.identityId, referral.identityId), eq(dpdpMembership.state, "active")) })
  ).map((m) => m.orgId)

  const advisoryRelationshipsFromReferrerOrgs = referrerActiveOrgIds.length
    ? await db.query.dpdpRelationship.findMany({
        where: and(eq(dpdpRelationship.kind, "advises"), isNull(dpdpRelationship.endedAt)),
      }).then((rows) => rows.filter((r) => referrerActiveOrgIds.includes(r.fromOrg)))
    : []

  const reason = decideReferralConflict({ referrerActiveOrgIds, referredOrgId, advisoryRelationshipsFromReferrerOrgs })

  await db.insert(dpdpReferralEvent).values({
    referralId: referral.identityId,
    referredOrgId,
    outcome: reason ? "blocked" : "signed_up",
    blockReason: reason,
  })

  return { referralIdentityId: referral.identityId, blocked: reason !== null, reason }
}
