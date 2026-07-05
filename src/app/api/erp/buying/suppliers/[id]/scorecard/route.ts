import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getSupplierScorecard, ServiceError } from "@/lib/services/erp-buying-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await context.params
    const scorecard = await getSupplierScorecard({ orgId }, id)
    return NextResponse.json(scorecard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier scorecard error:", error)
    return NextResponse.json({ error: "Failed to compute supplier scorecard" }, { status: 500 })
  }
}
