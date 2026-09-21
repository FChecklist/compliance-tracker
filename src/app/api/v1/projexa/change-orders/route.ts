import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveWriteActorId } from "@/lib/supabase/auth-guard"
import { listChangeOrders, createChangeOrder, ServiceError } from "@/lib/services/construction-change-order-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
  const status = request.nextUrl.searchParams.get("status") ?? undefined

  try {
    const changeOrders = await listChangeOrders({ orgId: ctx.orgId }, projectId, { status })
    return NextResponse.json({ changeOrders })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa change-orders list error:", error)
    return NextResponse.json({ error: "Failed to list change orders" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  // PROJEXA-E2E-001 actor-misattribution sweep: see resolveWriteActorId's own
  // header in auth-guard.ts -- requestedById feeds construction-exceptions-
  // service.ts's findSelfApprovedChangeOrders() fraud check
  // (approvedById === requestedById), so a misattributed creator id here
  // defeats that segregation-of-duties control. The [id]/route.ts submit/
  // e-sign path already resolves a real actor (R-97); this create path did
  // not until now.
  const acting = await resolveWriteActorId(request, ctx)
  if (acting.error) return acting.error

  try {
    const body = await request.json()
    const changeOrder = await createChangeOrder({ orgId: ctx.orgId, userId: acting.actorId }, body)
    return NextResponse.json(changeOrder, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa change-orders create error:", error)
    return NextResponse.json({ error: "Failed to create change order" }, { status: 500 })
  }
}
