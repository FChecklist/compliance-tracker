import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { listNoticeVersions, publishNoticeVersion } from "@/lib/services/dpdp-governance-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const notices = await listNoticeVersions(result.ctx.orgId)
    return NextResponse.json({ notices })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load notices")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  if (result.ctx.level !== "owner") return NextResponse.json({ error: "Only the boss can publish a notice" }, { status: 403 })
  try {
    const body = await request.json()
    const notice = await publishNoticeVersion({ orgId: result.ctx.orgId, actorIdentityId: result.ctx.identityId, docKind: body?.docKind ?? "privacy_notice", version: body?.version ?? "1.0", languages: Array.isArray(body?.languages) ? body.languages : ["English"] })
    return NextResponse.json(notice, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not publish that notice")
  }
}
