import { NextRequest, NextResponse } from "next/server"
import { requireDpdpIdentity } from "@/lib/services/dpdp-session"
import { createDpdpOrganisation, listOrganisationsForIdentity } from "@/lib/services/dpdp-organisation-service"
import { instantiateObligationsForOrg } from "@/lib/services/dpdp-obligation-service"
import { ensureDraftObligationLibrarySeeded } from "@/lib/services/dpdp-obligation-library"
import { switchDpdpActiveOrg } from "@/lib/services/dpdp-auth-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { recordReferralAttempt } from "@/lib/services/dpdp-referral-service"

// "Open the account -- one person, free forever." Uses requireDpdpIdentity
// (session only, no org required yet) because THIS is the route that
// creates the first one.
export async function POST(request: NextRequest) {
  const result = await requireDpdpIdentity()
  if ("response" in result) return result.response

  try {
    const body = await request.json()
    const org = await createDpdpOrganisation({ identityId: result.ctx.identityId, name: body?.name ?? "", sector: body?.sector, extraCapabilities: body?.extraCapabilities })

    await ensureDraftObligationLibrarySeeded()
    await instantiateObligationsForOrg(org.id, result.ctx.identityId)

    // The session that created this org now switches onto it in place --
    // no new cookie needed, the existing one's underlying row just gets a
    // real active_org_id instead of null.
    await switchDpdpActiveOrg(result.ctx.sessionId, result.ctx.identityId, org.id)

    // ?ref=CODE (WO-DPDP-003 4.9) -- best-effort, never fatal to org
    // creation. A bad/unknown code, or a conflict (self_referral/
    // shared_advisor), is recordReferralAttempt's own job to classify and
    // log; this route doesn't need to know or react to the outcome.
    const refCode = body?.referralCode ?? request.nextUrl.searchParams.get("ref")
    if (refCode) {
      try {
        await recordReferralAttempt(String(refCode), org.id)
      } catch {
        // Unknown/inactive code -- not the new org's problem.
      }
    }

    return NextResponse.json({ organisation: org }, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not create the organisation")
  }
}

// Identity-only, deliberately: which orgs you belong to is meaningful even
// with no ACTIVE org selected yet (e.g. just accepted a second invite).
export async function GET() {
  const result = await requireDpdpIdentity()
  if ("response" in result) return result.response

  try {
    const orgs = await listOrganisationsForIdentity(result.ctx.identityId)
    return NextResponse.json({ organisations: orgs })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not list organisations")
  }
}
