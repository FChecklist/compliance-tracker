// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): thin alias over
// erp-goods-receipt-service.ts's listPurchaseReceipts/createPurchaseReceipt
// -- stage 5 of the workflow (recording physical goods receipt against a
// submitted PO). Every line item requires a receiving warehouse (see the
// service's own validation) -- PROJEXA's create-goods-receipt form should
// source warehouseId from /v1/projexa/inventory/warehouses.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listPurchaseReceipts, createPurchaseReceipt, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ goodsReceipts: [] })

  try {
    const goodsReceipts = await listPurchaseReceipts({ orgId: ctx.orgId })
    return NextResponse.json({ goodsReceipts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement goods-receipts list error:", error)
    return NextResponse.json({ error: "Failed to fetch goods receipts" }, { status: 500 })
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
    if (!body.postingDate) return NextResponse.json({ error: "postingDate is required" }, { status: 400 })
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const receipt = await createPurchaseReceipt(actorCtx, {
      supplierId: body.supplierId, purchaseOrderId: body.purchaseOrderId, postingDate: body.postingDate, items: body.items,
    })
    return NextResponse.json(receipt, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement goods-receipt create error:", error)
    return NextResponse.json({ error: "Failed to create goods receipt" }, { status: 500 })
  }
}
