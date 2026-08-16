// Priority 15 (Sales & CRM depth wave): bulk status update, thin alias over
// erp-selling-service.ts's bulkUpdateSalesOrderStatus. Orders whose current
// status doesn't allow the requested transition are reported back as
// `skipped`/`missing` rather than silently ignored or failing the batch.
//
// VERIDIAN Review Framework remediation: routed through the shared
// permission-service.ts utility (ERP_ACTION_ROLES["erp.sales_orders.update_status"]
// = "manager") -- no behavior change from the previous inline
// requireRoleOrScope(ctx, "manager", "write") call. This route's own
// pre-existing "manager" bar is exactly what [id]/route.ts's single-record
// PATCH was brought up to match in this same wave -- see that route's
// comment for the inconsistency this closes.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePermission } from "@/lib/services/permission-service"
import { bulkUpdateSalesOrderStatus, ServiceError } from "@/lib/services/erp-selling-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requirePermission(ctx, "erp.sales_orders.update_status")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!Array.isArray(body.salesOrderIds) || !body.salesOrderIds.length) return NextResponse.json({ error: "salesOrderIds (non-empty array) is required" }, { status: 400 })
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 })
    const result = await bulkUpdateSalesOrderStatus({ orgId: ctx.orgId, userId: actorId }, body.salesOrderIds, body.status)
    return NextResponse.json({
      updated: result.updated.map((so) => ({ id: so.id, status: so.status })),
      skippedIds: result.skippedIds,
      missingIds: result.missingIds,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sales-orders bulk-status error:", error)
    return NextResponse.json({ error: "Failed to bulk-update sales order status" }, { status: 500 })
  }
}
