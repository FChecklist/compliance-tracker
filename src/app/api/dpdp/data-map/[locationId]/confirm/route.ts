import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { confirmDataLocation } from "@/lib/services/dpdp-data-map-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { locationId } = await params
    const body = await request.json()
    const row = await confirmDataLocation(result.ctx.orgId, result.ctx.identityId, locationId, body?.pathText ?? "")
    return NextResponse.json(row)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not save that")
  }
}
