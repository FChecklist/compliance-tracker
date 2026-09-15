import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { acceptObligation } from "@/lib/services/dpdp-obligation-service"
import { resolveIdentityLabel } from "@/lib/services/dpdp-organisation-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ obligationId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { obligationId } = await params
    const label = await resolveIdentityLabel(result.ctx.identityId)
    const updated = await acceptObligation(result.ctx.orgId, result.ctx.identityId, label, obligationId)
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not accept that")
  }
}
