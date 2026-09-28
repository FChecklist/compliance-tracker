import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { getOrCreateAiLink, listAiLinkReads, rotateAiLink } from "@/lib/services/dpdp-ai-link-service"
import { dpdpInternalAiEnabled, dpdpInternalAiOffResponse } from "@/lib/dpdp-internal-ai"

export async function GET() {
  if (!dpdpInternalAiEnabled()) return dpdpInternalAiOffResponse()
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
  if (!dpdpInternalAiEnabled()) return dpdpInternalAiOffResponse()
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const link = await rotateAiLink(result.ctx.orgId, result.ctx.identityId)
    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not replace your AI Link")
  }
}
