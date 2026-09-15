import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { listSubmittedForReview } from "@/lib/services/dpdp-obligation-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const obligations = await listSubmittedForReview(result.ctx.orgId)
    return NextResponse.json({ obligations })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load things to check")
  }
}
