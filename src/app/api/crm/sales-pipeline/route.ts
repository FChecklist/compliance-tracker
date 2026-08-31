import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getSalesPipelineDashboardData, setSalesTarget, ServiceError } from "@/lib/services/crm-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ deals: [], targets: [] })

  try {
    const data = await getSalesPipelineDashboardData({ orgId })
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM sales pipeline dashboard error:", error)
    return NextResponse.json({ error: "Failed to fetch sales pipeline dashboard" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const target = await setSalesTarget({ orgId, userId: dbUser.id }, { month: body.month, targetValue: Number(body.targetValue) })
    return NextResponse.json(target, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM sales pipeline target set error:", error)
    return NextResponse.json({ error: "Failed to set sales target" }, { status: 500 })
  }
}
