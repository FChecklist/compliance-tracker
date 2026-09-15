import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { revokeDpdpMembership } from "@/lib/services/dpdp-organisation-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ membershipId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  if (result.ctx.level !== "owner") return NextResponse.json({ error: "Only the boss can remove people" }, { status: 403 })

  try {
    const { membershipId } = await params
    await revokeDpdpMembership(result.ctx.orgId, result.ctx.identityId, membershipId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not remove that person")
  }
}
