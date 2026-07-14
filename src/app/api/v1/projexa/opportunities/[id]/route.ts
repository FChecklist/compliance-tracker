// Priority 15 (PROJEXA Sales & CRM, Wave 1): stage-update alias over
// crm-service.ts's updateOpportunity. AI analysis (analyzeOpportunity) and
// follow-up-task chaining are deliberately NOT aliased here -- see the
// sibling leads/[id]/route.ts comment for the same Wave 1 scope note.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateOpportunity, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const body = await request.json()
    const opportunity = await updateOpportunity({ orgId: ctx.orgId, userId: actorId }, id, {
      stage: body.stage, estimatedValue: body.estimatedValue, expectedCloseDate: body.expectedCloseDate, ownerId: body.ownerId,
      nextActionDate: body.nextActionDate, nextActionNote: body.nextActionNote,
    }, body.note)
    return NextResponse.json({
      id: opportunity.id, name: opportunity.name, stage: opportunity.stage,
      estimatedValue: opportunity.estimatedValue, expectedCloseDate: opportunity.expectedCloseDate, ownerId: opportunity.ownerId,
      nextActionDate: opportunity.nextActionDate, nextActionNote: opportunity.nextActionNote,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa opportunity update error:", error)
    return NextResponse.json({ error: "Failed to update opportunity" }, { status: 500 })
  }
}
