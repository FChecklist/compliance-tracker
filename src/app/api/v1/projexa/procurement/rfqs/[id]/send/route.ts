// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// sendRfq -- moves a draft RFQ to 'sent' so it becomes visible to invited
// suppliers on their vendor-portal token (Wave 80).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { sendRfq, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError
  const actorId = acting.person.id

  try {
    const { id } = await params
    const actorCtx = { orgId: ctx.orgId, userId: actorId, ...acting.actor }
    const rfq = await sendRfq(actorCtx, id)
    return NextResponse.json(rfq)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement rfq send error:", error)
    return NextResponse.json({ error: "Failed to send RFQ" }, { status: 500 })
  }
}
