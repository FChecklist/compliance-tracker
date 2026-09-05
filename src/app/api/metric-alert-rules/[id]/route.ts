import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateMetricAlertRule, deleteMetricAlertRule, ServiceError } from "@/lib/services/metric-alert-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // R75 Part 2 Phase 5 (G8-misc): matches custom-charts/[id]'s own
  // requireRole(dbUser, "manager") gate on PATCH/DELETE (same sibling
  // feature -- see POST /api/metric-alert-rules's own comment).
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateMetricAlertRule({ orgId }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Metric alert rule update error:", error)
    return NextResponse.json({ error: "Failed to update metric alert rule" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    await deleteMetricAlertRule({ orgId }, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Metric alert rule delete error:", error)
    return NextResponse.json({ error: "Failed to delete metric alert rule" }, { status: 500 })
  }
}
