// Priority 17 Wave 1 (PROJEXA Inventory/Stock exposure): thin alias over
// erp-stock-service.ts's listItems/createItem. These are real ERP stock
// items (erp_items -- warehouse/batch/serial/FIFO tracked), distinct from
// PROJEXA's pre-existing "Materials" page (a different, construction-
// specific materials table with no warehouse/stock-ledger concept).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import { listItems, createItem, ServiceError } from "@/lib/services/erp-stock-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const items = await listItems({ orgId: ctx.orgId })
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory items list error:", error)
    return NextResponse.json({ error: "Failed to fetch items" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError
  const actorId = acting.person.id

  try {
    const body = await request.json()
    if (!body.itemCode?.trim() || !body.itemName?.trim()) {
      return NextResponse.json({ error: "itemCode and itemName are required" }, { status: 400 })
    }
    const actorCtx = { orgId: ctx.orgId, userId: actorId, ...acting.actor }
    const item = await createItem(actorCtx, {
      itemCode: body.itemCode, itemName: body.itemName, uom: body.uom,
      standardBuyingRate: body.standardBuyingRate, standardSellingRate: body.standardSellingRate,
      hasBatchNo: body.hasBatchNo, hasSerialNo: body.hasSerialNo, hsnSacCode: body.hsnSacCode,
    })
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory item create error:", error)
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 })
  }
}
