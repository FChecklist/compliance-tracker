import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listStockLedger, ServiceError } from "@/lib/services/erp-inventory-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ entries: [] })

  try {
    const entries = await listStockLedger({ orgId: ctx.orgId }, {
      itemId: request.nextUrl.searchParams.get("itemId") ?? undefined,
      warehouseId: request.nextUrl.searchParams.get("warehouseId") ?? undefined,
    })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 erp inventory ledger list error:", error)
    return NextResponse.json({ error: "Failed to fetch stock ledger" }, { status: 500 })
  }
}
