// WO-DPDP-003 Section 5.2 / the mockup's "Confirm and sign off" screen.
// Gated by requireDpdpSigner(), not an inline level==="owner" check --
// WO-DPDP-003 Section 3 is explicit that can_sign, not level, is the real
// signing permission ("One permission flag: can_sign, on a person, never
// on a level"). A handful of other routes in this codebase still gate
// owner-only actions on `level`, which happens to be correct for THOSE
// actions (inviting people, naming relationships) but attest specifically
// is a signing act, so it uses the signing primitive.
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { dpdpRelationship } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { requireDpdpSigner } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { listDataMap } from "@/lib/services/dpdp-data-map-service"
import { logDpdpEvent } from "@/lib/services/dpdp-event-service"

export async function GET() {
  const result = await requireDpdpSigner()
  if ("response" in result) return result.response
  try {
    const orgId = result.ctx.orgId
    const dataMap = await listDataMap(orgId)
    const relationships = await withDpdpContext({ orgId }, (tx) =>
      tx.query.dpdpRelationship.findMany({ where: eq(dpdpRelationship.fromOrg, orgId) }),
    )
    return NextResponse.json({
      dataLocations: { found: dataMap.filter((d) => d.location?.state === "confirmed").length, total: dataMap.length },
      relationships: { signed: relationships.filter((r) => r.agreementSignedAt).length, total: relationships.length },
    })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load the attestation summary")
  }
}

export async function POST() {
  const result = await requireDpdpSigner()
  if ("response" in result) return result.response
  try {
    await logDpdpEvent({
      orgId: result.ctx.orgId,
      actorIdentityId: result.ctx.identityId,
      actorLabel: "Owner",
      kind: "attestation_signed",
      summary: "Confirmed the answers are true and complete, as far as they know",
    })
    return NextResponse.json({ signed: true }, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not record the attestation")
  }
}
