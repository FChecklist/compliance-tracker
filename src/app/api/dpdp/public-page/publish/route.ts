import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { publishPublicPage } from "@/lib/services/dpdp-governance-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  if (result.ctx.level !== "owner") return NextResponse.json({ error: "Only the boss can publish this" }, { status: 403 })
  try {
    const body = await request.json()
    const page = await publishPublicPage({ orgId: result.ctx.orgId, actorIdentityId: result.ctx.identityId, verifiedVia: body?.verifiedVia ?? "document" })
    return NextResponse.json(page, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not publish the page")
  }
}
