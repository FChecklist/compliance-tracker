// WO-DPDP-001 4.1/4.9 -- signing the processor/auditor agreement, and the
// read paths an advisor/processor/auditor use to see what a relationship
// actually grants them. Naming a relationship lives in
// dpdp-organisation-service.ts (nameDpdpRelationship); this file is what
// happens to one afterwards.
import { and, eq, isNull } from "drizzle-orm"
import { dpdpRelationship } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { assertDpdpRelationship } from "./dpdp-organisation-service"
import { logDpdpEvent } from "./dpdp-event-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

/** Only the counterpart (from_org for processes_for/audits) may sign -- the client cannot sign on their behalf. */
export async function signRelationshipAgreement(actorOrgId: string, actorIdentityId: string, relationshipId: string) {
  return withDpdpContext({ orgId: actorOrgId }, async (tx) => {
    const rel = await tx.query.dpdpRelationship.findFirst({ where: and(eq(dpdpRelationship.id, relationshipId), eq(dpdpRelationship.fromOrg, actorOrgId)) })
    if (!rel) throw new ServiceError("Not found", 404)
    if (rel.agreementSignedAt) throw new ServiceError("Already signed", 409)
    const [updated] = await tx.update(dpdpRelationship).set({ agreementSignedAt: new Date() }).where(eq(dpdpRelationship.id, relationshipId)).returning()
    await logDpdpEvent({ orgId: actorOrgId, actorIdentityId, actorLabel: "Owner", kind: "relationship_agreement_signed", summary: "Signed the agreement" }, tx)
    return updated
  })
}

export async function listRelationshipsForOrg(orgId: string) {
  return withDpdpContext({ orgId }, (tx) =>
    tx.query.dpdpRelationship.findMany({ where: and(eq(dpdpRelationship.toOrg, orgId), isNull(dpdpRelationship.endedAt)) })
  )
}

export async function listServedByOrg(orgId: string) {
  return withDpdpContext({ orgId }, (tx) =>
    tx.query.dpdpRelationship.findMany({ where: and(eq(dpdpRelationship.fromOrg, orgId), isNull(dpdpRelationship.endedAt)) })
  )
}

export async function endRelationship(actorOrgId: string, actorIdentityId: string, relationshipId: string) {
  return withDpdpContext({ orgId: actorOrgId }, async (tx) => {
    const rel = await tx.query.dpdpRelationship.findFirst({
      where: and(eq(dpdpRelationship.id, relationshipId), isNull(dpdpRelationship.endedAt)),
    })
    if (!rel || (rel.fromOrg !== actorOrgId && rel.toOrg !== actorOrgId)) throw new ServiceError("Not found", 404)
    const [updated] = await tx.update(dpdpRelationship).set({ endedAt: new Date() }).where(eq(dpdpRelationship.id, relationshipId)).returning()
    await logDpdpEvent({ orgId: actorOrgId, actorIdentityId, actorLabel: "Owner", kind: "relationship_ended", summary: "Ended a relationship" }, tx)
    return updated
  })
}

export { assertDpdpRelationship }
