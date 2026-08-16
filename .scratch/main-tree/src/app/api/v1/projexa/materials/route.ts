// Wave 124: thin alias over erp-inventory-service.ts's stock ledger,
// construction-domain field names (materialId/consumedQuantity instead of
// itemId/quantityChange). Receipts/issues stay on the generic
// /api/v1/erp/inventory/{receipts,issues} paths -- those already read
// naturally for a construction integrator (POST a receipt/issue), so this
// namespace doesn't duplicate them, only the read-side ledger listing.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listStockLedger, ServiceError } from "@/lib/services/erp-inventory-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ materials: [] })

  try {
    const entries = await listStockLedger({ orgId: ctx.orgId }, {
      itemId: request.nextUrl.searchParams.get("materialId") ?? undefined,
      warehouseId: request.nextUrl.searchParams.get("warehouseId") ?? undefined,
    })
    const materials = entries.map((e) => ({
      id: e.id, materialId: e.itemId, warehouseId: e.warehouseId, postingDate: e.postingDate,
      movementType: e.voucherType, quantityChange: e.quantityChange, valuationRate: e.valuationRate,
      balanceQuantity: e.balanceQty, balanceValue: e.balanceValue, projectId: e.projectId,
    }))
    return NextResponse.json({ materials })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa materials list error:", error)
    return NextResponse.json({ error: "Failed to fetch material ledger" }, { status: 500 })
  }
}
