import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { sendConsentCampaign } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

// "One link each, no accounts" -- `contacts` is a plaintext email array
// used only to send; nothing here persists it (see dpdp-principal-
// service.ts's own header for why).
export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    const outcome = await sendConsentCampaign({
      orgId: result.ctx.orgId, actorIdentityId: result.ctx.identityId,
      groupId: body?.groupId ?? "", noticeVersionId: body?.noticeVersionId ?? "", contacts: Array.isArray(body?.contacts) ? body.contacts : [],
    })
    return NextResponse.json(outcome, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not send the campaign")
  }
}
