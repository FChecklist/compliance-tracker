import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { markBoardNotified } from "@/lib/services/dpdp-governance-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ breachId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { breachId } = await params
    const updated = await markBoardNotified(result.ctx.orgId, result.ctx.identityId, breachId)
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not update that")
  }
}
