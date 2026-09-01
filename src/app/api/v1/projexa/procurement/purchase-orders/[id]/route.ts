// Real-screen conversion (2026-08-30): single-PO GET for the Purchase Order
// Object Page -- getPurchaseOrder() already existed in erp-buying-service.ts
// with no plain GET route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getPurchaseOrder, ServiceError } from "@/lib/services/erp-buying-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const po = await getPurchaseOrder({ orgId: ctx.orgId }, id)
    return NextResponse.json(po)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa purchase order get error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase order" }, { status: 500 })
  }
}
