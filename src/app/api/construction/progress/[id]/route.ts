import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { deleteProgressEntry, ServiceError } from "@/lib/services/construction-progress-service"

// R48 gap-closure (2026-08-29, F085: "Progress entry delete recalculates
// cumulative"): no delete path existed for a progress entry at all before
// this -- confirmed by reading construction-progress-service.ts and both
// existing progress API routes first. Every cumulative/earned-value figure
// (dashboards, reports) is computed live from these rows at read time, never
// cached, so a plain DELETE is sufficient -- the next read of any dependent
// figure naturally excludes the removed entry. Same requireAuth() + org-scope
// pattern as construction-boq-service.ts's deleteBoq() and its own route.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const result = await deleteProgressEntry({ orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Construction progress entry delete error:", error)
    return NextResponse.json({ error: "Failed to delete progress entry" }, { status: 500 })
  }
}
