import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { recordOfficerDecision } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ grievanceId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { grievanceId } = await params
    const body = await request.json()
    const updated = await recordOfficerDecision(result.ctx.orgId, result.ctx.identityId, grievanceId, body?.decision ?? "")
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not record that decision")
  }
}
