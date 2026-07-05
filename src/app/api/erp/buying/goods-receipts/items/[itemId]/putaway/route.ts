import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updatePutawayLocation, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { itemId } = await params
    const body = await request.json()
    const item = await updatePutawayLocation({ orgId }, itemId, body.warehouseId)
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Putaway location update error:", error)
    return NextResponse.json({ error: "Failed to update putaway location" }, { status: 500 })
  }
}
