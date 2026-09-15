import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { acceptArtefact } from "@/lib/services/dpdp-artefact-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ artefactId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { artefactId } = await params
    const updated = await acceptArtefact(result.ctx.orgId, result.ctx.identityId, artefactId)
    return NextResponse.json(updated)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not accept that")
  }
}
