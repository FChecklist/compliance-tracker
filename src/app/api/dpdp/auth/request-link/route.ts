// Public by design (TOKEN_SCOPED-adjacent, matching the class of route
// authz-gap-inventory.test.ts already exempts for pre-session flows) --
// this IS the sign-in mechanism, so it cannot itself require a session.
// Never reveals whether the email exists (dpdp-auth-service's own note).
import { NextRequest, NextResponse } from "next/server"
import { requestDpdpMagicLink } from "@/lib/services/dpdp-auth-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const requestIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    await requestDpdpMagicLink(body?.email ?? "", { requestedOrgId: body?.orgId, requestIp })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not send the link")
  }
}
