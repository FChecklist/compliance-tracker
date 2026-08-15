import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { rejectClaim, ServiceError } from "@/lib/services/construction-billing-workflow-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const claim = await rejectClaim({ orgId, userId: dbUser.id }, id, body.rejectionReason)
    return NextResponse.json(claim)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Progress claim reject error:", error)
    return NextResponse.json({ error: "Failed to reject progress claim" }, { status: 500 })
  }
}
