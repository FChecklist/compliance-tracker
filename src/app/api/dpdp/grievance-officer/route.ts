import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { appointGrievanceOfficer, getCurrentGrievanceOfficer } from "@/lib/services/dpdp-governance-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const officer = await getCurrentGrievanceOfficer(result.ctx.orgId)
    return NextResponse.json({ officer: officer ?? null })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load the grievance officer")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  if (result.ctx.level !== "owner") return NextResponse.json({ error: "Only the boss can appoint the officer" }, { status: 403 })
  try {
    const body = await request.json()
    const officer = await appointGrievanceOfficer({ orgId: result.ctx.orgId, actorIdentityId: result.ctx.identityId, ...body })
    return NextResponse.json(officer, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not appoint the officer")
  }
}
