import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateReportDefinition, deleteReportDefinition, ServiceError } from "@/lib/services/report-engine-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G4 reports): PATCH/DELETE previously had no role check
// at all. Matches the sibling POST /api/reports/definitions gate (same
// reasoning: report_definitions.executionConfig resolves against the same
// broad TABLE_REGISTRY custom-charts/route.ts's manager-gated config does).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateReportDefinition({ orgId }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report definition update error:", error)
    return NextResponse.json({ error: "Failed to update report definition" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    await deleteReportDefinition({ orgId }, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report definition delete error:", error)
    return NextResponse.json({ error: "Failed to delete report definition" }, { status: 500 })
  }
}
