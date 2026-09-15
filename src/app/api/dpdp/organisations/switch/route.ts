import { NextRequest, NextResponse } from "next/server"
import { requireDpdpIdentity } from "@/lib/services/dpdp-session"
import { switchDpdpActiveOrg } from "@/lib/services/dpdp-auth-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest) {
  const result = await requireDpdpIdentity()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    await switchDpdpActiveOrg(result.ctx.sessionId, result.ctx.identityId, body?.orgId ?? "")
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not switch organisation")
  }
}
