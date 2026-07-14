// Priority 15 (Sales & CRM depth wave): status-update alias over
// erp-selling-service.ts's updateSalesOrderStatus, which now enforces a
// real draft -> confirmed -> partially_fulfilled -> fulfilled lifecycle
// (or -> cancelled from any pre-terminal state) via a transition table.
// Bulk status update lives at the sibling bulk-status/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateSalesOrderStatus, ServiceError } from "@/lib/services/erp-selling-service"

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
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 })
    const salesOrder = await updateSalesOrderStatus({ orgId: ctx.orgId, userId: actorId }, id, body.status)
    return NextResponse.json({ id: salesOrder.id, soNumber: salesOrder.soNumber, status: salesOrder.status })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-order update error:", error)
    return NextResponse.json({ error: "Failed to update sales order" }, { status: 500 })
  }
}
