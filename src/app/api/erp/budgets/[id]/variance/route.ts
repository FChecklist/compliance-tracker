import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getBudgetVariance, ServiceError } from "@/lib/services/erp-budget-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") || undefined
    const variance = await getBudgetVariance({ orgId }, id, asOfDate)
    return NextResponse.json(variance)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Budget variance error:", error)
    return NextResponse.json({ error: "Failed to compute budget variance" }, { status: 500 })
  }
}
