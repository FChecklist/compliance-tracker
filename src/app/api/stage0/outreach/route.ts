import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listStage0OutreachForOrg, ServiceError } from "@/lib/services/stage0-service"

// Priority 18b (Owner directive 2026-07-15, design doc section 2.4):
// org-admin-facing audit view -- "which of our real users have messaged
// which stage-0 users, and when." manager-or-above only, same bar this
// codebase already uses for other org-wide people-data views.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const rows = await listStage0OutreachForOrg(orgId)
    return NextResponse.json({ outreach: rows })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stage-0 outreach error:", error)
    return NextResponse.json({ error: "Failed to load stage-0 outreach" }, { status: 500 })
  }
}
