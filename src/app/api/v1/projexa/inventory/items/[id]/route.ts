// Real-screen conversion (2026-08-30): the Inventory items list never had a
// detail route -- standardBuyingRate/standardSellingRate/hsnSacCode/
// hasSerialNo were accepted on create but never shown anywhere again.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getItem, ServiceError } from "@/lib/services/erp-stock-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const item = await getItem({ orgId: ctx.orgId }, id)
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory item get error:", error)
    return NextResponse.json({ error: "Failed to fetch item" }, { status: 500 })
  }
}
