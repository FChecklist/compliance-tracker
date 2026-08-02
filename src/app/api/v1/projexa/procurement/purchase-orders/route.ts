// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// erp-buying-service.ts's listPurchaseOrders/createPurchaseOrder -- stage 4
// of the workflow (converting an accepted quotation into a real PO). This
// route creates a fresh draft PO from caller-supplied line items (typically
// copied from a chosen supplier quotation on the PROJEXA side) -- the
// underlying service has no automatic quotation->PO copy function, so
// PROJEXA's "Convert to PO" action passes the quotation's own item/rate
// data through as the new PO's input, same shape convertQuotationToSalesOrder
// uses on the sales side.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listPurchaseOrders, createPurchaseOrder, ServiceError } from "@/lib/services/erp-buying-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ purchaseOrders: [] })

  try {
    const purchaseOrders = await listPurchaseOrders({ orgId: ctx.orgId })
    return NextResponse.json({ purchaseOrders })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement purchase-orders list error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase orders" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!body.supplierId) return NextResponse.json({ error: "supplierId is required" }, { status: 400 })
    if (!body.items?.length) return NextResponse.json({ error: "At least one line item is required" }, { status: 400 })
    if (!body.orderDate) return NextResponse.json({ error: "orderDate is required" }, { status: 400 })
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const po = await createPurchaseOrder(actorCtx, {
      supplierId: body.supplierId, orderDate: body.orderDate, expectedDeliveryDate: body.expectedDeliveryDate, items: body.items,
    })
    return NextResponse.json(po, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement purchase-order create error:", error)
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 })
  }
}
