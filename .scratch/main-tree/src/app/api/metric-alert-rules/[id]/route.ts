import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateMetricAlertRule, deleteMetricAlertRule, ServiceError } from "@/lib/services/metric-alert-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

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
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

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
