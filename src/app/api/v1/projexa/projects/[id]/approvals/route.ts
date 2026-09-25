// PROJEXA-BUILD-001 U-29 (register rows BR-409, BR-410). Surface 1 of the four-surface contract
// (ai-os/projexa-build-001/FOUR_SURFACE_CONTRACT.md): the AI-prepared approval list of one project.
//
// GET answers 200 with the proposals an AI has prepared for the project and, for each, the one approve action:
// a POST of the submission id to this same path. The proposals are the pending rows of compliance.submissions
// that carry a prepared chain (src/lib/pipeline/prepared-proposals.ts): the ones the U-31 email bridge stores
// when a BOQ line item is promoted from an email, and the ones POST .../paste-back stores. GET writes nothing
// and asks no model.
//
// POST is the approve action. It confirms the proposal from the parameters stored with it, merged with the
// `params` the person adds (PMD-38), never by re-deriving them from the stored words. The person is the signed-in
// user, or the person an API key names in X-Acting-User / X-Acting-User-Email (requireActingPerson): a key that
// names nobody is refused with 400 before anything is read (PMD-34), and the person, not the key, is the actor of
// the write (PMD-35). It writes the line item through the create_boq registry entry and one audit row per line
// item with surface s1_one_page_ai_prepared.
//
// A project of another organisation, or one a project-pinned key may not reach, is a 404 on both methods, and a
// proposal that belongs to another project reads as absent.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import { ServiceError } from "@/lib/services/compliance-service"
import { withRouteTiming } from "@/lib/route-timing"
import {
  approveActionFor,
  approvedRecordOf,
  confirmPreparedProposal,
  findReadableProject,
  listPreparedProposals,
  recordApprovalAudit,
  S1_SURFACE,
} from "@/lib/pipeline/prepared-proposals"

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

export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  try {
    let body: Record<string, unknown>
    try {
      const parsed: unknown = await request.json()
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object")
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 })
    }

    // PMD-34 / PMD-35: the approval is made by a person. An API-key call that names nobody is a 400 here, before the
    // proposal is read; the person's own id and role are what the pipeline records the write under.
    const { acting, error: actingError } = await requireActingPerson(request, ctx, body)
    if (actingError) return actingError

    const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : ""
    if (!submissionId) return NextResponse.json({ error: "submissionId is required" }, { status: 400 })
    const added = body.params ?? {}
    if (typeof added !== "object" || added === null || Array.isArray(added)) {
      return NextResponse.json({ error: "params must be an object" }, { status: 400 })
    }

    const { id } = await params
    const project = await findReadableProject({ orgId: ctx.orgId, apiKey: ctx.apiKey }, id)
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const outcome = await confirmPreparedProposal({
      orgId: ctx.orgId,
      projectId: project.id,
      submissionId,
      person: { id: acting.person.id, role: acting.person.role },
      params: added as Record<string, unknown>,
    })
    if (!outcome.ok) {
      switch (outcome.reason) {
        case "not_found":
          return NextResponse.json({ error: "That proposal is not on this project" }, { status: 404 })
        case "already_decided":
          return NextResponse.json({ error: "That proposal has already been decided", status: outcome.status }, { status: 409 })
        case "needs_input":
          // 200, not an error: the answer is a question, and nothing was written.
          return NextResponse.json({ approved: false, status: "needs_input", missing: outcome.missing }, { status: 200 })
        case "invalid":
          return NextResponse.json(
            { approved: false, error: "The proposal cannot be written as it stands", failure: outcome.failure, detail: outcome.detail },
            { status: 422 }
          )
        case "failed": {
          const { segmentText: _segmentText, ...failure } = outcome.result.failures[0] ?? { segmentText: "" }
          return NextResponse.json({ approved: false, error: "The proposal could not be written", failure }, { status: 409 })
        }
      }
    }

    const record = approvedRecordOf(outcome.result)
    try {
      const audit = await recordApprovalAudit({
        orgId: ctx.orgId,
        actor: acting.actor,
        request,
        submissionId,
        chain: outcome.chain,
        result: outcome.result,
      })
      return NextResponse.json(
        {
          approved: true,
          submissionId,
          boqId: record.boqId,
          route: record.route,
          lineItemIds: record.lineItemIds,
          audit: { surface: S1_SURFACE, rows: audit.entityIds.length, entityType: audit.entityType },
        },
        { status: 201 }
      )
    } catch (auditError) {
      // The record is saved. Say so, and say the audit row is not, rather than answering 201 over a gap in the trail.
      console.error("v1 projexa approvals audit write error:", auditError)
      return NextResponse.json(
        {
          approved: true,
          code: "AUDIT_WRITE_FAILED",
          error: "The line item was saved but its audit row could not be written",
          submissionId,
          boqId: record.boqId,
          lineItemIds: record.lineItemIds,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa approvals approve error:", error)
    return NextResponse.json({ error: "Failed to approve the proposal" }, { status: 500 })
  }
}
