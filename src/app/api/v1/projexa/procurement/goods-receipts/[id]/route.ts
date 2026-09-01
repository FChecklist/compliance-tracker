// Real-screen conversion (2026-08-30): single-goods-receipt GET for the
// Goods Receipt Object Page -- getPurchaseReceipt() already existed in
// erp-goods-receipt-service.ts with no plain GET route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getPurchaseReceipt, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const receipt = await getPurchaseReceipt({ orgId: ctx.orgId }, id)
    return NextResponse.json(receipt)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa goods receipt get error:", error)
    return NextResponse.json({ error: "Failed to fetch goods receipt" }, { status: 500 })
  }
}
