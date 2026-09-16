// WO-DPDP-004 5.10 -- receiving a pasted-back AI proposal and reviewing it.
// Session-gated: the proposal's own content carries no authority (see
// dpdp-ai-link-service.ts's header) -- only a real signed-in session may
// record or apply one.
import { NextRequest, NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { dpdpAiProposal, dpdpAiProposalLine } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"
import { recordAiProposal, type ProposedLine } from "@/lib/services/dpdp-ai-link-service"

export async function GET() {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const proposals = await withDpdpContext({ orgId: result.ctx.orgId }, (tx) =>
      tx.query.dpdpAiProposal.findMany({ where: eq(dpdpAiProposal.orgId, result.ctx.orgId), orderBy: [desc(dpdpAiProposal.arrivedAt)], limit: 20 }),
    )
    const withLines = await Promise.all(
      proposals.map(async (p) => ({
        ...p,
        lines: await withDpdpContext({ orgId: result.ctx.orgId }, (tx) => tx.query.dpdpAiProposalLine.findMany({ where: eq(dpdpAiProposalLine.proposalId, p.id) })),
      })),
    )
    return NextResponse.json({ proposals: withLines })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load AI proposals")
  }
}

export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    const lines: ProposedLine[] = Array.isArray(body?.lines) ? body.lines : []
    const { proposal, lines: classified } = await recordAiProposal({
      orgId: result.ctx.orgId,
      sourceLabel: String(body?.sourceLabel ?? "an AI"),
      raw: String(body?.raw ?? JSON.stringify(lines)),
      lines,
    })
    return NextResponse.json({ proposal, lines: classified }, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not record that proposal")
  }
}
