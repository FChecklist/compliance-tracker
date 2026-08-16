import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { getBudget, getBudgetActuals } from "@/lib/services/pms-budget-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    await requirePmsEnabled(orgId)
    const { id } = await params
    const [budget, actuals] = await Promise.all([
      getBudget({ orgId }, id),
      getBudgetActuals({ orgId }, id),
    ])
    return NextResponse.json({ ...budget, ...actuals })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS budget get error:", error)
    return NextResponse.json({ error: "Failed to fetch budget" }, { status: 500 })
  }
}
