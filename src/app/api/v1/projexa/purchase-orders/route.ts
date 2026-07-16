// Priority 17 Wave 1 (multi-currency Selling & Buying): thin alias over
// erp-buying-service.ts's listPurchaseOrders/createPurchaseOrder -- did not
// exist before this wave under /api/v1/projexa/* (only vendors/route.ts
// touched erp-buying-service.ts, for supplier/vendor master data). PROJEXA
// had no way to create a purchase order at all until now, confirmed by a
// full-repo search of both codebases. Zero new business logic here, same
// aliasing pattern as quotations/sales-orders/sales-invoices -- reshapes
// field names into vendor-facing language to match vendors/route.ts's own
// toVendorShape() convention (supplierId -> vendorId in the response), the
// underlying erp_purchase_orders table is unchanged.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listPurchaseOrders, createPurchaseOrder, ServiceError, type PurchaseOrderItemInput } from "@/lib/services/erp-buying-service"

function toPurchaseOrderShape(po: Awaited<ReturnType<typeof listPurchaseOrders>>[number]) {
  return {
    id: po.id,
    poNumber: po.poNumber,
    vendorId: po.supplierId,
    companyId: po.companyId,
    orderDate: po.orderDate,
    expectedDeliveryDate: po.expectedDeliveryDate,
    status: po.status,
    currencyId: po.currencyId,
    exchangeRate: po.exchangeRate,
    grandTotal: po.grandTotal,
    items: po.items?.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, rate: i.rate, amount: i.amount, receivedQuantity: i.receivedQuantity })) ?? [],
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ purchaseOrders: [] })

  const params = request.nextUrl.searchParams
  try {
    const orders = await listPurchaseOrders({ orgId: ctx.orgId }, { companyId: params.get("companyId") ?? undefined })
    return NextResponse.json({ purchaseOrders: orders.map(toPurchaseOrderShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa purchase-orders list error:", error)
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
    const items: PurchaseOrderItemInput[] = (body.items ?? []).map((i: PurchaseOrderItemInput) => ({
      itemId: i.itemId, description: i.description, quantity: i.quantity, rate: i.rate,
    }))
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const po = await createPurchaseOrder(actorCtx, {
      supplierId: body.vendorId, orderDate: body.orderDate, expectedDeliveryDate: body.expectedDeliveryDate, companyId: body.companyId,
      currencyId: body.currencyId, exchangeRate: body.exchangeRate, items,
    })
    return NextResponse.json(toPurchaseOrderShape({ ...po, items: [] }), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa purchase-order create error:", error)
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 })
  }
}
