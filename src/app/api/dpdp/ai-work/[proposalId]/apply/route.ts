import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { resolveIdentityLabel } from "@/lib/services/dpdp-organisation-service"
import { applyAiProposal } from "@/lib/services/dpdp-ai-link-service"
import { dpdpInternalAiEnabled, dpdpInternalAiOffResponse } from "@/lib/dpdp-internal-ai"

export async function POST(request: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  if (!dpdpInternalAiEnabled()) return dpdpInternalAiOffResponse()
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const { proposalId } = await params
    const body = await request.json().catch(() => ({}))
    const label = await resolveIdentityLabel(result.ctx.identityId)
    const outcome = await applyAiProposal({
      orgId: result.ctx.orgId,
      actorIdentityId: result.ctx.identityId,
      actorLabel: label,
      proposalId,
      approvedLineIds: Array.isArray(body?.approvedLineIds) ? body.approvedLineIds : [],
    })
    return NextResponse.json(outcome)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not apply that proposal")
  }
}
