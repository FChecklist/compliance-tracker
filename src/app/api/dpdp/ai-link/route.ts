import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { getOrCreateAiLink, listAiLinkReads, rotateAiLink } from "@/lib/services/dpdp-ai-link-service"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const link = await getOrCreateAiLink(result.ctx.orgId, result.ctx.identityId)
    const reads = await listAiLinkReads(result.ctx.orgId, result.ctx.identityId)
    return NextResponse.json({ ...link, reads })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load your AI Link")
  }
}

/** "Replace my link" -- old one dies immediately. */
export async function POST() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const link = await rotateAiLink(result.ctx.orgId, result.ctx.identityId)
    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not replace your AI Link")
  }
}
