import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getItemValuation, ServiceError } from "@/lib/services/erp-inventory-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const itemId = request.nextUrl.searchParams.get("itemId")
    const warehouseId = request.nextUrl.searchParams.get("warehouseId")
    if (!itemId || !warehouseId) return NextResponse.json({ error: "itemId and warehouseId are required" }, { status: 400 })
    const valuation = await getItemValuation({ orgId }, itemId, warehouseId)
    return NextResponse.json(valuation)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Item valuation error:", error)
    return NextResponse.json({ error: "Failed to fetch valuation" }, { status: 500 })
  }
}
