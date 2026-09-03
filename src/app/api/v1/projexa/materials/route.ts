// Wave 124: thin alias over erp-inventory-service.ts's stock ledger,
// construction-domain field names (materialId/consumedQuantity instead of
// itemId/quantityChange). Receipts/issues stay on the generic
// /api/v1/erp/inventory/{receipts,issues} paths -- those already read
// naturally for a construction integrator (POST a receipt/issue), so this
// namespace doesn't duplicate them, only the read-side ledger listing.
import { NextRequest, NextResponse } from "next/server"
import { inArray, eq, and } from "drizzle-orm"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listStockLedger, ServiceError } from "@/lib/services/erp-inventory-service"
import { db } from "@/lib/db"
import { erpItems, erpWarehouses } from "@/lib/db/schema"
import { withRouteTiming } from "@/lib/route-timing"

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const entries = await listStockLedger({ orgId: ctx.orgId }, {
      itemId: request.nextUrl.searchParams.get("materialId") ?? undefined,
      warehouseId: request.nextUrl.searchParams.get("warehouseId") ?? undefined,
    })

    // R63/Sumeet-modules gap-closure (2026-08-29): this route's own mapped
    // output previously exposed only raw itemId/warehouseId UUIDs -- the
    // one new consumer (the /materials page, built the same day this was
    // found) needs a real material NAME to be usable at all, not just an
    // opaque id. erp-inventory-service.ts's own listItemBalances() already
    // does this exact itemId->erpItems join a few functions over; mirrored
    // here rather than changing listStockLedger's return shape (other
    // existing callers of listStockLedger depend on its current shape).
    const itemIds = [...new Set(entries.map((e) => e.itemId))]
    const warehouseIds = [...new Set(entries.map((e) => e.warehouseId))]
    const [items, warehouses] = await Promise.all([
      itemIds.length > 0
        ? db.query.erpItems.findMany({ where: and(eq(erpItems.orgId, ctx.orgId), inArray(erpItems.id, itemIds)) })
        : Promise.resolve([] as (typeof erpItems.$inferSelect)[]),
      warehouseIds.length > 0
        ? db.query.erpWarehouses.findMany({ where: and(eq(erpWarehouses.orgId, ctx.orgId), inArray(erpWarehouses.id, warehouseIds)) })
        : Promise.resolve([] as (typeof erpWarehouses.$inferSelect)[]),
    ])
    const itemMap = new Map(items.map((i) => [i.id, i]))
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]))

    const materials = entries.map((e) => ({
      id: e.id, materialId: e.itemId, warehouseId: e.warehouseId, postingDate: e.postingDate,
      movementType: e.voucherType, quantityChange: e.quantityChange, valuationRate: e.valuationRate,
      balanceQuantity: e.balanceQty, balanceValue: e.balanceValue, projectId: e.projectId,
      itemCode: itemMap.get(e.itemId)?.itemCode ?? null,
      itemName: itemMap.get(e.itemId)?.itemName ?? null,
      uom: itemMap.get(e.itemId)?.uom ?? null,
      warehouseName: warehouseMap.get(e.warehouseId)?.warehouseName ?? null,
    }))
    return NextResponse.json({ materials })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa materials list error:", error)
    return NextResponse.json({ error: "Failed to fetch material ledger" }, { status: 500 })
  }
}
