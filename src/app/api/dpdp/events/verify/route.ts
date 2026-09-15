// D9: "hash chain verifies across >= 50 events" -- the endpoint the
// Auditor's "Can this be trusted?" screen calls.
import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { verifyDpdpEventChain } from "@/lib/services/dpdp-event-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const verification = await verifyDpdpEventChain(result.ctx.orgId)
    return NextResponse.json(verification)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not verify the chain")
  }
}
