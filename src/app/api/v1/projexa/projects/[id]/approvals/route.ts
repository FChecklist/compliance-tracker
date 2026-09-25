// PROJEXA-BUILD-001 U-29 (register row BR-409). Surface 1 of the four-surface contract
// (ai-os/projexa-build-001/FOUR_SURFACE_CONTRACT.md): the AI-prepared approval list of one project.
//
// GET answers 200 with the proposals an AI has prepared for the project and, for each, the one approve action:
// a POST of the submission id to this same path. The proposals are the pending rows of compliance.submissions
// that carry a prepared chain (src/lib/pipeline/prepared-proposals.ts): the ones the U-31 email bridge stores
// when a BOQ line item is promoted from an email, and the ones POST .../paste-back stores. GET writes nothing
// and asks no model. A project of another organisation, or one a project-pinned key may not reach, is a 404.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { ServiceError } from "@/lib/services/compliance-service"
import { withRouteTiming } from "@/lib/route-timing"
import { approveActionFor, findReadableProject, listPreparedProposals } from "@/lib/pipeline/prepared-proposals"

export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const project = await findReadableProject({ orgId: ctx.orgId, apiKey: ctx.apiKey }, id)
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const proposals = await listPreparedProposals({ orgId: ctx.orgId }, project.id)
    return NextResponse.json({
      projectId: project.id,
      count: proposals.length,
      proposals: proposals.map((proposal) => ({ ...proposal, approve: approveActionFor(project.id, proposal.submissionId) })),
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa approvals list error:", error)
    return NextResponse.json({ error: "Failed to read the approvals of this project" }, { status: 500 })
  }
}
