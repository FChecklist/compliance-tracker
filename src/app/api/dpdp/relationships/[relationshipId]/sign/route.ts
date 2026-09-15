import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { signRelationshipAgreement } from "@/lib/services/dpdp-relationship-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ relationshipId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { relationshipId } = await params
    const updated = await signRelationshipAgreement(result.ctx.orgId, result.ctx.identityId, relationshipId)
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not sign that")
  }
}
