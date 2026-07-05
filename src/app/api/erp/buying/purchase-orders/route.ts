import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listPurchaseOrders, createPurchaseOrder, ServiceError } from "@/lib/services/erp-buying-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ purchaseOrders: [] })

  try {
    const purchaseOrders = await listPurchaseOrders({ orgId })
    return NextResponse.json({ purchaseOrders })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase orders list error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase orders" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const po = await createPurchaseOrder({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(po, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase order create error:", error)
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 })
  }
}
