import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { answerRightsRequest } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { requestId } = await params
    const body = await request.json()
    const updated = await answerRightsRequest(result.ctx.orgId, result.ctx.identityId, requestId, body?.answerText ?? "")
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not save that answer")
  }
}
