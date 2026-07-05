import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listStockLedger, ServiceError } from "@/lib/services/erp-inventory-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [] })

  try {
    const itemId = request.nextUrl.searchParams.get("itemId") || undefined
    const warehouseId = request.nextUrl.searchParams.get("warehouseId") || undefined
    const entries = await listStockLedger({ orgId }, { itemId, warehouseId })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stock ledger list error:", error)
    return NextResponse.json({ error: "Failed to fetch stock ledger" }, { status: 500 })
  }
}
