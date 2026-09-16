// WO-DPDP-003 Section 4.9 / the mockup's "🎁 Refer and earn" -- surfaced as
// a quiet text link in the app bar, never a coloured badge (Section 5.1).
import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { getOrCreateMyReferral, listMyReferralActivity } from "@/lib/services/dpdp-referral-service"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const activity = await listMyReferralActivity(result.ctx.identityId)
    return NextResponse.json(activity)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load your referral activity")
  }
}

/** "I agree — give me my code" -- issues one if this identity doesn't already have it. */
export async function POST() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const referral = await getOrCreateMyReferral(result.ctx.identityId)
    return NextResponse.json(referral, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not create your referral code")
  }
}
