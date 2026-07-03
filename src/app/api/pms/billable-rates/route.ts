import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePmsEnabled, ServiceError } from "@/lib/services/pms-enablement-service"
import { listBillableRates, setBillableRate } from "@/lib/services/pms-time-service"
import { hasRole } from "@/lib/supabase/auth-guard"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ billableRates: [] })

  try {
    await requirePmsEnabled(orgId)
    const billableRates = await listBillableRates({ orgId })
    return NextResponse.json({ billableRates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS billable-rates list error:", error)
    return NextResponse.json({ error: "Failed to fetch billable rates" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  if (!hasRole(dbUser, "admin")) return NextResponse.json({ error: "Setting billable rates requires admin role or higher" }, { status: 403 })

  try {
    await requirePmsEnabled(orgId)
    const body = await request.json()
    const result = await setBillableRate({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS billable-rate create error:", error)
    return NextResponse.json({ error: "Failed to set billable rate" }, { status: 500 })
  }
}
