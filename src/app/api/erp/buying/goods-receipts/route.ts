import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPurchaseReceipts, createPurchaseReceipt, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ receipts: [] })

  try {
    const receipts = await listPurchaseReceipts({ orgId })
    return NextResponse.json({ receipts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Goods receipts list error:", error)
    return NextResponse.json({ error: "Failed to fetch goods receipts" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const receipt = await createPurchaseReceipt({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(receipt, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Goods receipt create error:", error)
    return NextResponse.json({ error: "Failed to create goods receipt" }, { status: 500 })
  }
}
