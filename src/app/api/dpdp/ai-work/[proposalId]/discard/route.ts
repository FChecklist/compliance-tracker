import { NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { resolveIdentityLabel } from "@/lib/services/dpdp-organisation-service"
import { discardAiProposal } from "@/lib/services/dpdp-ai-link-service"

export async function POST(_request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { proposalId } = await params
    const label = await resolveIdentityLabel(result.ctx.identityId)
    const proposal = await discardAiProposal(result.ctx.orgId, result.ctx.identityId, label, proposalId)
    return NextResponse.json(proposal)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not discard that proposal")
  }
}
