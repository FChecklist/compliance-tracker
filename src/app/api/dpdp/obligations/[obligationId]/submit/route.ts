import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { submitObligation } from "@/lib/services/dpdp-obligation-service"
import { resolveIdentityLabel } from "@/lib/services/dpdp-organisation-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ obligationId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { obligationId } = await params
    const body = await request.json()
    const label = await resolveIdentityLabel(result.ctx.identityId)
    const updated = await submitObligation(result.ctx.orgId, result.ctx.identityId, label, obligationId, body?.note ?? "(nothing written)")
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not submit that")
  }
}
