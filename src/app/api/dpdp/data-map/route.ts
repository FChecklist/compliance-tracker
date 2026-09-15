import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { listDataMap, addDataCategory } from "@/lib/services/dpdp-data-map-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const rows = await listDataMap(result.ctx.orgId)
    return NextResponse.json({ rows })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load the data map")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    const row = await addDataCategory({ orgId: result.ctx.orgId, actorIdentityId: result.ctx.identityId, ...body })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not add that")
  }
}
