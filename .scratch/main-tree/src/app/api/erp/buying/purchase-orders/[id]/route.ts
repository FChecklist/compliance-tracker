import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getPurchaseOrder, ServiceError } from "@/lib/services/erp-buying-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const po = await getPurchaseOrder({ orgId }, id)
    return NextResponse.json(po)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase order get error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase order" }, { status: 500 })
  }
}
