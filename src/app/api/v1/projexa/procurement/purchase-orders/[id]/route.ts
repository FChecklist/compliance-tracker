// Real-screen conversion (2026-08-30): single-PO GET for the Purchase Order
// Object Page -- getPurchaseOrder() already existed in erp-buying-service.ts
// with no plain GET route.
// R80 GAP-6: PATCH/DELETE added -- this route was GET-only, which is the
// upstream half of "Purchase Orders has no Edit and no Delete at any layer".
// Both are draft-only and refuse a PO with goods receipts against it; the rule
// and its evidence live on updatePurchaseOrder() in erp-buying-service.ts.
// DELETE is a CANCEL (status -> 'cancelled'), never a row delete, for the same
// reason cancelSalesInvoice() is.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getPurchaseOrder, updatePurchaseOrder, cancelPurchaseOrder, ServiceError } from "@/lib/services/erp-buying-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const po = await getPurchaseOrder({ orgId: ctx.orgId }, id)
    return NextResponse.json(po)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa purchase order get error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase order" }, { status: 500 })
  }
}

// Same actor/role shape as this resource's own POST (../route.ts): a
// server-to-server caller carries no user id, so the actor is the API key.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const po = await updatePurchaseOrder(actorCtx, id, {
      supplierId: body.supplierId, orderDate: body.orderDate, expectedDeliveryDate: body.expectedDeliveryDate,
      companyId: body.companyId, projectId: body.projectId, currencyId: body.currencyId, exchangeRate: body.exchangeRate,
    })
    return NextResponse.json(po)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa purchase order update error:", error)
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const po = await cancelPurchaseOrder(actorCtx, id)
    return NextResponse.json(po)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa purchase order cancel error:", error)
    return NextResponse.json({ error: "Failed to cancel purchase order" }, { status: 500 })
  }
}
