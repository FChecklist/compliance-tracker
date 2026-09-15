import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { listGrievances } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const grievances = await listGrievances(result.ctx.orgId)
    return NextResponse.json({ grievances })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load complaints")
  }
}
