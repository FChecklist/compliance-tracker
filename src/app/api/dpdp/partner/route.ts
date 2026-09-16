// WO-DPDP-003 Section 4.9 / the mockup's "🤝 Sell it, and get paid" -- a
// small pill bottom-left, never a coloured badge (Section 5.1). Partner is
// keyed by email, not membership -- a partner need not be a dpdp customer
// (see dpdp-partner-service.ts's own header), so this reads/writes against
// the caller's own primary email, resolved off their identity.
import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { resolveIdentityLabel } from "@/lib/services/dpdp-organisation-service"
import { applyForPartner, getPartnerByEmail } from "@/lib/services/dpdp-partner-service"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const email = await resolveIdentityLabel(result.ctx.identityId)
    const partner = await getPartnerByEmail(email)
    return NextResponse.json({ partner })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load your partner status")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const email = await resolveIdentityLabel(result.ctx.identityId)
    const body = await request.json().catch(() => ({}))
    const partner = await applyForPartner({ email, kind: body?.kind, describesSelf: body?.describesSelf })
    return NextResponse.json(partner, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not submit your partner application")
  }
}
