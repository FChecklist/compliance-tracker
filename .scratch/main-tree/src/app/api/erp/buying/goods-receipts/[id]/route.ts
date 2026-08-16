import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getPurchaseReceipt, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const receipt = await getPurchaseReceipt({ orgId }, id)
    return NextResponse.json(receipt)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Goods receipt get error:", error)
    return NextResponse.json({ error: "Failed to fetch goods receipt" }, { status: 500 })
  }
}
