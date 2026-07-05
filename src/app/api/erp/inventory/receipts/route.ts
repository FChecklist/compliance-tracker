import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { recordStockReceipt, ServiceError } from "@/lib/services/erp-inventory-service"

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const entry = await recordStockReceipt({ orgId, userId: dbUser.id, dbUser }, { ...body, voucherType: body.voucherType ?? "manual_receipt", voucherId: body.voucherId ?? "manual" })
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stock receipt error:", error)
    return NextResponse.json({ error: "Failed to record stock receipt" }, { status: 500 })
  }
}
