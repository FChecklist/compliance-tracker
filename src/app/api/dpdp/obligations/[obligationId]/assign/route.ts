import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { assignObligation } from "@/lib/services/dpdp-obligation-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ obligationId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  if (result.ctx.level !== "owner") return NextResponse.json({ error: "Only the boss can give a job to someone" }, { status: 403 })
  try {
    const { obligationId } = await params
    const body = await request.json()
    const updated = await assignObligation(result.ctx.orgId, result.ctx.identityId, obligationId, body?.assignedPersonId ?? "")
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not assign that")
  }
}
