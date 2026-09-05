import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listSavedReports, createSavedReport, ServiceError } from "@/lib/services/custom-report-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ reports: [] })

  try {
    const reports = await listSavedReports({ orgId })
    return NextResponse.json({ reports })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Saved reports list error:", error)
    return NextResponse.json({ error: "Failed to fetch saved reports" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G4 reports): had no role check at all. Saved reports
  // only ever query custom-report-service.ts's own GROUP_BY_FIELDS whitelist
  // (compliance_items/notices/risks/pms_issues/incidents/construction
  // operational tables -- no financial tables at all, unlike report
  // definitions' broader TABLE_REGISTRY), so "member" is the right floor --
  // the same low-stakes-create posture as this codebase's other config-
  // create routes over a narrow, non-financial whitelist.
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await createSavedReport({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Saved report create error:", error)
    return NextResponse.json({ error: "Failed to create saved report" }, { status: 500 })
  }
}
