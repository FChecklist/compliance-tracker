// Priority 17 Wave 1 (PROJEXA Inventory/Stock exposure): thin alias over
// erp-inventory-service.ts's listStockLedger/recordStockReceipt/
// recordStockIssue. A single POST body shape with a `type` discriminator
// ("receipt"|"issue") -- both post through the same real FIFO valuation
// engine every other stock movement in this codebase already uses (see
// erp-inventory-service.ts's own header comment), never a bespoke PROJEXA-
// side ledger.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listStockLedger, recordStockReceipt, recordStockIssue, ServiceError } from "@/lib/services/erp-inventory-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ stockEntries: [] })

  try {
    const sp = request.nextUrl.searchParams
    const entries = await listStockLedger({ orgId: ctx.orgId }, {
      itemId: sp.get("itemId") ?? undefined,
      warehouseId: sp.get("warehouseId") ?? undefined,
    })
    return NextResponse.json({ stockEntries: entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory stock-entries list error:", error)
    return NextResponse.json({ error: "Failed to fetch stock entries" }, { status: 500 })
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
    if (body.type !== "receipt" && body.type !== "issue") {
      return NextResponse.json({ error: "type must be 'receipt' or 'issue'" }, { status: 400 })
    }
    if (!body.itemId || !body.warehouseId || !body.quantity || !body.postingDate) {
      return NextResponse.json({ error: "itemId, warehouseId, quantity, and postingDate are required" }, { status: 400 })
    }
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }

    const entry = body.type === "receipt"
      ? await recordStockReceipt(actorCtx, {
          itemId: body.itemId, warehouseId: body.warehouseId, quantity: body.quantity, rate: body.rate ?? 0,
          postingDate: body.postingDate, voucherType: body.voucherType ?? "manual_receipt", voucherId: body.voucherId ?? actorId,
          uom: body.uom, batchNumber: body.batchNumber, expiryDate: body.expiryDate,
        })
      : await recordStockIssue(actorCtx, {
          itemId: body.itemId, warehouseId: body.warehouseId, quantity: body.quantity,
          postingDate: body.postingDate, voucherType: body.voucherType ?? "manual_issue", voucherId: body.voucherId ?? actorId,
          uom: body.uom,
        })
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory stock-entry create error:", error)
    return NextResponse.json({ error: "Failed to record stock entry" }, { status: 500 })
  }
}
