// Priority 15 (Sales & CRM depth wave): status-update alias over
// erp-selling-service.ts's updateSalesOrderStatus, which enforces a real
// draft -> confirmed -> partially_fulfilled -> fulfilled lifecycle (or ->
// cancelled from any pre-terminal state) via a transition table. Bulk
// status update lives at the sibling bulk-status/route.ts.
//
// VERIDIAN Review Framework remediation (Critical: Access Control /
// Role-Based Permissions): the real gap this wave closes. This route
// previously gated EVERY status transition -- including cancelling a
// confirmed order, a revenue-impacting, hard-to-cleanly-reverse action --
// at "member" rank, while its own sibling bulk-status/route.ts already
// required "manager" for the identical logical operation (a status
// transition on one or more sales orders through the same
// updateSalesOrderStatus/bulkUpdateSalesOrderStatus transition table).
// That is an inconsistency between two routes performing the same write,
// not a deliberately lower bar for the single-record path -- a data-entry
// clerk could cancel or confirm a sales order one at a time even though
// the bulk endpoint already refused them. Fixed by bringing this route to
// the same "manager" policy already established and shipped for
// bulk-status (ERP_ACTION_ROLES["erp.sales_orders.update_status"]), via
// the shared permission-service.ts utility so both routes read from the
// same single source of truth going forward instead of two independently
// maintained string literals.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePermission } from "@/lib/services/permission-service"
import { updateSalesOrderStatus, ServiceError } from "@/lib/services/erp-selling-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requirePermission(ctx, "erp.sales_orders.update_status")
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
