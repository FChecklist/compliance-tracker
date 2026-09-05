import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
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
  // R75 Part 2 Phase 5 (G8-misc): had no role check at all. Matches
  // custom-charts's own requireRole(dbUser, "manager") gate -- the most
  // similar sibling feature (an org-wide, notifying report/alert
  // definition), same minimum for the same reason.
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

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
