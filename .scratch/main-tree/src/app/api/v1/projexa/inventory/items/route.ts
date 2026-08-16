// Priority 17 Wave 1 (PROJEXA Inventory/Stock exposure): thin alias over
// erp-stock-service.ts's listItems/createItem. These are real ERP stock
// items (erp_items -- warehouse/batch/serial/FIFO tracked), distinct from
// PROJEXA's pre-existing "Materials" page (a different, construction-
// specific materials table with no warehouse/stock-ledger concept).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listItems, createItem, ServiceError } from "@/lib/services/erp-stock-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ items: [] })

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
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!body.itemCode?.trim() || !body.itemName?.trim()) {
      return NextResponse.json({ error: "itemCode and itemName are required" }, { status: 400 })
    }
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
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
