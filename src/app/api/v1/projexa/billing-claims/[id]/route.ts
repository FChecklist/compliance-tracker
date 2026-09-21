// Sumeet requirement #3 continued -- the per-claim status transitions
// (milestone_achieved -> drafted -> submitted -> client_approved -> invoiced,
// or rejected). One PATCH endpoint, dispatched by body.action, mirroring the
// state machine construction-billing-workflow-service.ts itself defines --
// never a raw status write, so an invalid transition is refused by the
// service layer's own CLAIM_TRANSITIONS table, not re-implemented here.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveWriteActorId } from "@/lib/supabase/auth-guard"
import {
  draftClaim, submitClaim, approveClaim, rejectClaim, invoiceApprovedClaim, getClaimTimeline, ServiceError,
} from "@/lib/services/construction-billing-workflow-service"

const ACTIONS = ["draft", "submit", "approve", "reject", "invoice"] as const

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params

  try {
    const timeline = await getClaimTimeline({ orgId: ctx.orgId }, id)
    return NextResponse.json(timeline)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa billing-claim timeline error:", error)
    return NextResponse.json({ error: "Failed to load the billing milestone's timeline" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params

  try {
    const body = await request.json()
    if (!ACTIONS.includes(body.action)) {
      return NextResponse.json({ error: `action must be one of: ${ACTIONS.join(", ")}` }, { status: 400 })
    }

    // PROJEXA-E2E-001 surface-4 fix: see rfis/[id]/route.ts's identical
    // comment and resolveWriteActorId's own header in auth-guard.ts.
    const acting = await resolveWriteActorId(request, ctx)
    if (acting.error) return acting.error
    const actorId = acting.actorId
    const claimCtx = { orgId: ctx.orgId, userId: actorId }
    let result: unknown
    switch (body.action as (typeof ACTIONS)[number]) {
      case "draft":
        result = await draftClaim(claimCtx, id)
        break
      case "submit":
        result = await submitClaim(claimCtx, id)
        break
      case "approve":
        result = await approveClaim(claimCtx, id)
        break
      case "reject":
        result = await rejectClaim(claimCtx, id, body.rejectionReason)
        break
      case "invoice":
        if (!body.billDate) return NextResponse.json({ error: "billDate is required" }, { status: 400 })
        if (!body.taxTemplateId) return NextResponse.json({ error: "taxTemplateId is required" }, { status: 400 })
        result = await invoiceApprovedClaim(
          { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser, apiKey: ctx.apiKey ?? undefined },
          id,
          { billDate: body.billDate, taxTemplateId: body.taxTemplateId }
        )
        break
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa billing-claim transition error:", error)
    return NextResponse.json({ error: "Failed to update the billing milestone" }, { status: 500 })
  }
}
