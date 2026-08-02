import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { approveClaim, ServiceError } from "@/lib/services/construction-billing-workflow-service"

// Records the client's real-world approval decision -- gated to manager+
// (same rank kpi-entries/[id]/approve requires), since this authorizes the
// claim to proceed to invoicing.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const claim = await approveClaim({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(claim)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Progress claim approve error:", error)
    return NextResponse.json({ error: "Failed to approve progress claim" }, { status: 500 })
  }
}
