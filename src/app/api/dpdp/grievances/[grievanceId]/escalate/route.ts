import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { escalateGrievance } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ grievanceId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { grievanceId } = await params
    const updated = await escalateGrievance(result.ctx.orgId, result.ctx.identityId, grievanceId)
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not escalate that")
  }
}
