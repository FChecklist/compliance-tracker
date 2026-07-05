import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { submitPurchaseReceipt, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const receipt = await submitPurchaseReceipt({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(receipt)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Goods receipt submit error:", error)
    return NextResponse.json({ error: "Failed to submit goods receipt" }, { status: 500 })
  }
}
