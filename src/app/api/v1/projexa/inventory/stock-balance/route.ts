// Priority 17 Wave 1 (PROJEXA Inventory/Stock exposure): thin alias over
// erp-inventory-service.ts's listStockBalances (new -- a genuinely new
// read-time aggregation over the existing FIFO stock ledger, added this
// wave; never a duplicated/cached balance table). Answers "what stock do I
// have, and where" -- the core Inventory page question.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listStockBalances, ServiceError } from "@/lib/services/erp-inventory-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ balances: [] })

  try {
    const sp = request.nextUrl.searchParams
    const balances = await listStockBalances({ orgId: ctx.orgId }, {
      warehouseId: sp.get("warehouseId") ?? undefined,
      itemId: sp.get("itemId") ?? undefined,
    })
    return NextResponse.json({ balances })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory stock-balance list error:", error)
    return NextResponse.json({ error: "Failed to fetch stock balances" }, { status: 500 })
  }
}
