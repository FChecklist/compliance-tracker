import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateSavedReport, deleteSavedReport, ServiceError } from "@/lib/services/custom-report-service"

type RouteContext = { params: Promise<{ id: string }> }

// R75 Part 2 Phase 5 (G4 reports): PATCH/DELETE previously had no role check
// at all. Matches the sibling POST /api/reports/saved gate (same reasoning:
// custom-report-service.ts's narrow, non-financial operational whitelist).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await updateSavedReport({ orgId }, id, body)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Saved report update error:", error)
    return NextResponse.json({ error: "Failed to update saved report" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    await deleteSavedReport({ orgId }, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Saved report delete error:", error)
    return NextResponse.json({ error: "Failed to delete saved report" }, { status: 500 })
  }
}
