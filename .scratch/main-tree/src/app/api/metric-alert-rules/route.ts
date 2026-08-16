import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMetricAlertRules, createMetricAlertRule, ServiceError } from "@/lib/services/metric-alert-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rules: [] })

  try {
    const rules = await listMetricAlertRules({ orgId })
    return NextResponse.json({ rules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Metric alert rules list error:", error)
    return NextResponse.json({ error: "Failed to fetch metric alert rules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createMetricAlertRule({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Metric alert rule create error:", error)
    return NextResponse.json({ error: "Failed to create metric alert rule" }, { status: 500 })
  }
}
