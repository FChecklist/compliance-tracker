import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getThreeWayMatchReport, ServiceError } from "@/lib/services/erp-goods-receipt-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const lines = await getThreeWayMatchReport({ orgId }, id)
    return NextResponse.json({ lines })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Three-way match report error:", error)
    return NextResponse.json({ error: "Failed to compute three-way match report" }, { status: 500 })
  }
}
