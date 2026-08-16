// Priority 15 (PROJEXA Sales & CRM): status-update alias over crm-service.ts's
// updateLead, which now also records a crm_stage_history row on every real
// status change. AI scoring (scoreLead) and follow-up-task chaining are
// deliberately NOT aliased here -- out of scope for this module's own
// pipeline pages.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateLead, ServiceError } from "@/lib/services/crm-service"

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
    const lead = await updateLead({ orgId: ctx.orgId, userId: actorId }, id, {
      status: body.status, ownerId: body.ownerId, source: body.source,
      nextActionDate: body.nextActionDate, nextActionNote: body.nextActionNote,
    }, body.note)
    return NextResponse.json({
      id: lead.id, name: lead.name, status: lead.status, ownerId: lead.ownerId, source: lead.source,
      nextActionDate: lead.nextActionDate, nextActionNote: lead.nextActionNote,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa lead update error:", error)
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 })
  }
}
