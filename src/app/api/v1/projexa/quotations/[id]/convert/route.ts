// Priority 15 (Sales & CRM depth wave): quote -> sales order conversion,
// thin alias over erp-selling-service.ts's convertQuotationToSalesOrder.
// Only a 'sent' quotation can convert (see that function's own comment).
//
// VERIDIAN Review Framework remediation: routed through the shared
// permission-service.ts utility (ERP_ACTION_ROLES["erp.quotations.convert"]
// = "member") -- no behavior change. "member" remains correct here (not
// elevated to "manager") because a quotation can only reach 'sent' status
// after its 'approved' transition already required a real manager-rank
// session (see [id]/route.ts) -- converting an already-approved,
// already-sent quotation isn't a fresh privilege escalation.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePermission } from "@/lib/services/permission-service"
import { convertQuotationToSalesOrder, ServiceError } from "@/lib/services/erp-selling-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requirePermission(ctx, "erp.quotations.convert")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.orderDate) return NextResponse.json({ error: "orderDate is required" }, { status: 400 })
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const salesOrder = await convertQuotationToSalesOrder(actorCtx, id, { orderDate: body.orderDate, deliveryDate: body.deliveryDate })
    return NextResponse.json(salesOrder, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotation convert error:", error)
    return NextResponse.json({ error: "Failed to convert quotation to a sales order" }, { status: 500 })
  }
}
